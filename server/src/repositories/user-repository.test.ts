import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserRepository } from "./user-repository.js";
import type { GoogleIdentity, UserProfile } from "../types/domain.js";

const { mockCollection, mockClient } = vi.hoisted(() => {
  const mockCollection = {
    findOne: vi.fn(),
    insertOne: vi.fn(),
    replaceOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    createIndex: vi.fn()
  };
  const mockDb = { collection: vi.fn(() => mockCollection) };
  const mockClient = { connect: vi.fn(), db: vi.fn(() => mockDb) };
  return { mockCollection, mockClient };
});

vi.mock("mongodb", () => ({
  MongoClient: vi.fn(function () { return mockClient; })
}));

function makeRepo() {
  return new UserRepository({
    mongoUri: "mongodb://localhost:27017",
    databaseName: "test",
    collectionName: "users"
  });
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "user-1",
    googleSub: "google-sub-abc",
    email: "test@example.com",
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    profile: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeIdentity(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
  return {
    sub: "google-sub-abc",
    email: "test@example.com",
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    emailVerified: true,
    ...overrides
  };
}

const makeProfile = (): UserProfile => ({
  name: "Test User",
  heightCm: 175,
  weightKg: 70,
  styleNote: "",
  avatarUrl: null,
  fullBodyImageUrl: null,
  headshotImageUrl: null
});

describe("UserRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findById", () => {
    it("returns UserRecord when document exists", async () => {
      const repo = makeRepo();
      const doc = makeDoc();
      mockCollection.findOne.mockResolvedValue(doc);

      const result = await repo.findById("user-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("user-1");
      expect(result?.googleSub).toBe("google-sub-abc");
      expect(result?.email).toBe("test@example.com");
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: "user-1" });
    });

    it("returns null when no document matches", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);

      const result = await repo.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("upsertFromGoogleIdentity", () => {
    it("updates existing user found by googleSub", async () => {
      const repo = makeRepo();
      const existingDoc = makeDoc();
      mockCollection.findOne.mockResolvedValueOnce(existingDoc);
      mockCollection.replaceOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await repo.upsertFromGoogleIdentity(makeIdentity());

      expect(result.id).toBe("user-1");
      expect(mockCollection.replaceOne).toHaveBeenCalledOnce();
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it("updates existing user found by email when googleSub does not match", async () => {
      const repo = makeRepo();
      const existingDoc = makeDoc({ googleSub: "old-sub" });
      mockCollection.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingDoc);
      mockCollection.replaceOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await repo.upsertFromGoogleIdentity(makeIdentity({ sub: "new-sub" }));

      expect(result.id).toBe("user-1");
      expect(result.googleSub).toBe("new-sub");
      expect(mockCollection.replaceOne).toHaveBeenCalledOnce();
    });

    it("normalizes email to lowercase", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);
      mockCollection.insertOne.mockResolvedValue({ insertedId: "user-2" });

      const result = await repo.upsertFromGoogleIdentity(
        makeIdentity({ email: "TEST@Example.COM" })
      );

      expect(result.email).toBe("test@example.com");
      expect(mockCollection.findOne).toHaveBeenCalledWith({ googleSub: "google-sub-abc" });
      expect(mockCollection.findOne).toHaveBeenCalledWith({ email: "test@example.com" });
    });

    it("creates new user when no existing match", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);
      mockCollection.insertOne.mockResolvedValue({ insertedId: "user-new" });

      const result = await repo.upsertFromGoogleIdentity(makeIdentity());

      expect(result.googleSub).toBe("google-sub-abc");
      expect(result.profile).toBeNull();
      expect(mockCollection.insertOne).toHaveBeenCalledOnce();
      expect(mockCollection.replaceOne).not.toHaveBeenCalled();
    });

    it("preserves existing name when identity name is empty", async () => {
      const repo = makeRepo();
      const existingDoc = makeDoc({ name: "Original Name" });
      mockCollection.findOne.mockResolvedValueOnce(existingDoc);
      mockCollection.replaceOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await repo.upsertFromGoogleIdentity(makeIdentity({ name: "" }));

      expect(result.name).toBe("Original Name");
    });

    it("handles concurrent duplicate key error (code 11000) by reconciling", async () => {
      const repo = makeRepo();
      const concurrentDoc = makeDoc({ _id: "user-concurrent" });

      mockCollection.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(concurrentDoc);
      mockCollection.insertOne.mockRejectedValue({ code: 11000 });
      mockCollection.replaceOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await repo.upsertFromGoogleIdentity(makeIdentity());

      expect(result.id).toBe("user-concurrent");
      expect(mockCollection.replaceOne).toHaveBeenCalledOnce();
    });

    it("throws non-duplicate-key errors", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);
      const networkError = new Error("Network failure");
      mockCollection.insertOne.mockRejectedValue(networkError);

      await expect(repo.upsertFromGoogleIdentity(makeIdentity())).rejects.toThrow("Network failure");
    });
  });

  describe("updateProfile", () => {
    it("returns updated UserRecord with profile and name set", async () => {
      const repo = makeRepo();
      const profile = makeProfile();
      const updatedDoc = makeDoc({ name: profile.name, profile });
      mockCollection.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await repo.updateProfile("user-1", profile);

      expect(result).not.toBeNull();
      expect(result?.profile).toEqual(profile);
      expect(result?.name).toBe("Test User");
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "user-1" },
        expect.objectContaining({
          $set: expect.objectContaining({
            profile,
            name: profile.name
          })
        }),
        { returnDocument: "after" }
      );
    });

    it("returns null when user not found", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(null);

      const result = await repo.updateProfile("nonexistent", makeProfile());

      expect(result).toBeNull();
    });
  });
});
