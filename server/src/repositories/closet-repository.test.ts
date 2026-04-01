import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClosetRepository } from "./closet-repository.js";

const { mockCollection, mockClient } = vi.hoisted(() => {
  const mockCollection = {
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn()
    })),
    findOneAndUpdate: vi.fn(),
    deleteOne: vi.fn(),
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
  return new ClosetRepository({
    mongoUri: "mongodb://localhost:27017",
    databaseName: "test",
    collectionName: "closet_items"
  });
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "item-1",
    userId: "user-1",
    imageUrl: "https://example.com/image.jpg",
    analysisStatus: "pending" as const,
    analysisError: null,
    name: null,
    category: null,
    tags: [],
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("ClosetRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("deleteById", () => {
    it("returns true when item is deleted", async () => {
      const repo = makeRepo();
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await repo.deleteById("user-1", "item-1");

      expect(result).toBe(true);
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: "item-1", userId: "user-1" });
    });

    it("returns false when item not found", async () => {
      const repo = makeRepo();
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });

      const result = await repo.deleteById("user-1", "nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("updateMetadata", () => {
    it("returns updated record on success", async () => {
      const repo = makeRepo();
      const updated = makeDoc({ name: "Blue Shirt", category: "tops" });
      mockCollection.findOneAndUpdate.mockResolvedValue(updated);

      const result = await repo.updateMetadata("user-1", "item-1", {
        name: "Blue Shirt",
        category: "tops"
      });

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Blue Shirt");
      expect(result?.category).toBe("tops");
    });

    it("returns null when item not found", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(null);

      const result = await repo.updateMetadata("user-1", "nonexistent", { name: "test" });

      expect(result).toBeNull();
    });
  });

  describe("updateImage", () => {
    it("resets analysis fields and sets new image URL", async () => {
      const repo = makeRepo();
      const updated = makeDoc({ imageUrl: "https://example.com/new.jpg", analysisStatus: "pending" });
      mockCollection.findOneAndUpdate.mockResolvedValue(updated);

      const result = await repo.updateImage("user-1", "item-1", "https://example.com/new.jpg");

      expect(result).not.toBeNull();
      expect(result?.imageUrl).toBe("https://example.com/new.jpg");
      expect(result?.analysisStatus).toBe("pending");
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "item-1", userId: "user-1" },
        expect.objectContaining({
          $set: expect.objectContaining({
            imageUrl: "https://example.com/new.jpg",
            analysisStatus: "pending",
            name: null,
            category: null,
            tags: [],
            description: null
          })
        }),
        { returnDocument: "after" }
      );
    });
  });

  describe("importMany", () => {
    it("returns empty array when given empty input", async () => {
      const repo = makeRepo();
      const result = await repo.importMany("user-1", []);
      expect(result).toEqual([]);
    });

    it("inserts all items and returns records", async () => {
      const repo = makeRepo();
      mockCollection.insertMany.mockResolvedValue({ insertedCount: 2 });

      const items = [
        {
          imageUrl: "https://example.com/a.jpg",
          analysisStatus: "ready" as const,
          analysisError: null,
          name: "Jacket",
          category: "outerwear",
          tags: ["black"],
          description: "A black jacket"
        },
        {
          imageUrl: "https://example.com/b.jpg",
          analysisStatus: "ready" as const,
          analysisError: null,
          name: "Jeans",
          category: "pants",
          tags: [],
          description: null
        }
      ];

      const result = await repo.importMany("user-1", items);

      expect(mockCollection.insertMany).toHaveBeenCalledOnce();
      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("Jacket");
      expect(result[1]?.name).toBe("Jeans");
    });
  });

  describe("findById", () => {
    it("returns record when found", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(makeDoc({ name: "Red Dress" }));

      const result = await repo.findById("user-1", "item-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("item-1");
      expect(result?.name).toBe("Red Dress");
    });

    it("returns null when not found", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);

      const result = await repo.findById("user-1", "nonexistent");

      expect(result).toBeNull();
    });
  });
});
