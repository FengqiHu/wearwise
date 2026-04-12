import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendationRepository } from "./recommendation-repository.js";

const { mockCollection, mockClient } = vi.hoisted(() => {
  const mockCollection = {
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    deleteMany: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
    findOneAndUpdate: vi.fn(),
    createIndex: vi.fn()
  };
  const mockDb = { collection: vi.fn(() => mockCollection) };
  const mockClient = { connect: vi.fn(), db: vi.fn(() => mockDb) };
  return { mockCollection, mockClient };
});

vi.mock("mongodb", () => ({
  MongoClient: vi.fn(function () {
    return mockClient;
  })
}));

function makeRepo() {
  return new RecommendationRepository({
    mongoUri: "mongodb://localhost:27017",
    databaseName: "test",
    collectionName: "recommendations"
  });
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "rec-1",
    userId: "user-1",
    outfitName: "Casual Look",
    reason: "Comfortable",
    items: [{ id: "item-1", name: "Blue Shirt" }],
    occasions: [],
    generation: null,
    vote: null,
    conversationId: "conv-1",
    messageId: "msg-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeFindChain(docs: unknown[]) {
  return {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs)
  };
}

describe("RecommendationRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.find.mockReturnValue(makeFindChain([]));
  });

  describe("updateVote", () => {
    it("returns updated record with the new vote value", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc({ vote: "up" }));

      const result = await repo.updateVote("user-1", "rec-1", "up");

      expect(result?.vote).toBe("up");
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "rec-1", userId: "user-1" },
        expect.objectContaining({ $set: expect.objectContaining({ vote: "up" }) }),
        { returnDocument: "after" }
      );
    });

    it("clears vote when null is passed", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc({ vote: null }));

      const result = await repo.updateVote("user-1", "rec-1", null);

      expect(result?.vote).toBeNull();
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "rec-1", userId: "user-1" },
        expect.objectContaining({ $set: expect.objectContaining({ vote: null }) }),
        { returnDocument: "after" }
      );
    });

    it("returns null when recommendation is not found", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(null);

      const result = await repo.updateVote("user-1", "nonexistent", "up");

      expect(result).toBeNull();
    });
  });

  describe("findVotedByUser", () => {
    it("returns recommendations with up and down votes", async () => {
      const repo = makeRepo();
      const docs = [
        makeDoc({ _id: "rec-1", vote: "up" }),
        makeDoc({ _id: "rec-2", vote: "down" })
      ];
      mockCollection.find.mockReturnValue(makeFindChain(docs));

      const result = await repo.findVotedByUser("user-1");

      expect(result).toHaveLength(2);
      expect(result[0]?.vote).toBe("up");
      expect(result[1]?.vote).toBe("down");
    });

    it("queries only for up and down votes, excluding null", async () => {
      const repo = makeRepo();
      mockCollection.find.mockReturnValue(makeFindChain([]));

      await repo.findVotedByUser("user-1");

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({ vote: { $in: ["up", "down"] } })
      );
    });

    it("scopes the query to the given userId", async () => {
      const repo = makeRepo();
      mockCollection.find.mockReturnValue(makeFindChain([]));

      await repo.findVotedByUser("user-99");

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-99" })
      );
    });

    it("returns empty array when no voted recommendations exist", async () => {
      const repo = makeRepo();
      mockCollection.find.mockReturnValue(makeFindChain([]));

      const result = await repo.findVotedByUser("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("deleteByConversation", () => {
    it("deletes recommendations for the given user and conversation", async () => {
      const repo = makeRepo();
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 3 });

      const deletedCount = await repo.deleteByConversation("user-1", "conv-1");

      expect(deletedCount).toBe(3);
      expect(mockCollection.deleteMany).toHaveBeenCalledWith({
        userId: "user-1",
        conversationId: "conv-1"
      });
    });

    it("returns 0 when no recommendations match the conversation", async () => {
      const repo = makeRepo();
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 0 });

      const deletedCount = await repo.deleteByConversation("user-1", "missing-conv");

      expect(deletedCount).toBe(0);
  describe("listByUser", () => {
    it("returns recommendations for the given userId", async () => {
      const repo = makeRepo();
      const docs = [
        makeDoc({ _id: "rec-1" }),
        makeDoc({ _id: "rec-2" })
      ];
      mockCollection.find.mockReturnValue(makeFindChain(docs));

      const result = await repo.listByUser("user-1");

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("rec-1");
      expect(result[1]!.id).toBe("rec-2");
    });

    it("scopes query to the given userId", async () => {
      const repo = makeRepo();
      mockCollection.find.mockReturnValue(makeFindChain([]));

      await repo.listByUser("user-42");

      expect(mockCollection.find).toHaveBeenCalledWith({ userId: "user-42" });
    });

    it("respects the limit parameter", async () => {
      const repo = makeRepo();
      const chain = makeFindChain([]);
      mockCollection.find.mockReturnValue(chain);

      await repo.listByUser("user-1", 25);

      expect(chain.limit).toHaveBeenCalledWith(25);
    });

    it("returns empty array when no recommendations exist", async () => {
      const repo = makeRepo();
      mockCollection.find.mockReturnValue(makeFindChain([]));

      const result = await repo.listByUser("user-1");

      expect(result).toEqual([]);
    });
  });
});
