import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "./conversation-repository.js";

const { mockCollection, mockClient } = vi.hoisted(() => {
  const mockCollection = {
    insertOne: vi.fn(),
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
  return new ConversationRepository({
    mongoUri: "mongodb://localhost:27017",
    databaseName: "test",
    collectionName: "conversations"
  });
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "conv-1",
    userId: "user-1",
    title: "Hello there",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    messages: [
      {
        id: "msg-1",
        role: "user" as const,
        content: "Hello there",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    ...overrides
  };
}

describe("ConversationRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWithFirstUserMessage", () => {
    it("creates a new conversation and returns a record", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result = await repo.createWithFirstUserMessage("user-1", "What should I wear today?");

      expect(mockCollection.insertOne).toHaveBeenCalledOnce();
      expect(result.userId).toBe("user-1");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.role).toBe("user");
      expect(result.messages[0]?.content).toBe("What should I wear today?");
    });

    it("generates a title from the first message", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result = await repo.createWithFirstUserMessage("user-1", "What should I wear today?");

      expect(result.title).toBe("What should I wear today?");
    });

    it("truncates long messages to 48 chars with ellipsis in title", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const longMessage = "I need help picking an outfit for my important job interview tomorrow";
      const result = await repo.createWithFirstUserMessage("user-1", longMessage);

      expect(result.title).toHaveLength(48);
      expect(result.title.endsWith("...")).toBe(true);
    });

    it("uses 'New chat' title for blank message content", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result = await repo.createWithFirstUserMessage("user-1", "   ");

      expect(result.title).toBe("New chat");
    });

    it("normalizes whitespace in message content", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result = await repo.createWithFirstUserMessage("user-1", "  Hello   world  ");

      expect(result.title).toBe("Hello world");
    });

    it("each call creates a distinct conversation ID (no duplicate sessions)", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result1 = await repo.createWithFirstUserMessage("user-1", "First message");
      const result2 = await repo.createWithFirstUserMessage("user-1", "Second message");

      expect(result1.id).not.toBe(result2.id);
      expect(mockCollection.insertOne).toHaveBeenCalledTimes(2);
    });
  });

  describe("appendMessage", () => {
    it("appends a message to an existing conversation instead of creating a new one", async () => {
      const repo = makeRepo();
      const existingDoc = makeDoc({
        messages: [
          { id: "msg-1", role: "user", content: "Hello there", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "msg-2", role: "assistant", content: "Hi! How can I help?", createdAt: "2026-01-01T00:00:01.000Z" }
        ]
      });
      const updatedDoc = makeDoc({
        messages: [
          ...existingDoc.messages,
          { id: "msg-3", role: "user", content: "What should I wear?", createdAt: "2026-01-01T00:00:02.000Z" }
        ]
      });
      mockCollection.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await repo.appendMessage("user-1", "conv-1", "user", "What should I wear?");

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledOnce();
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.messages).toHaveLength(3);
      expect(result?.messages[2]?.content).toBe("What should I wear?");
    });

    it("appends assistant response to the same conversation", async () => {
      const repo = makeRepo();
      const updatedDoc = makeDoc({
        messages: [
          { id: "msg-1", role: "user", content: "What should I wear?", createdAt: "2026-01-01T00:00:00.000Z" },
          { id: "msg-2", role: "assistant", content: "I recommend the blue jacket!", createdAt: "2026-01-01T00:00:01.000Z" }
        ]
      });
      mockCollection.findOneAndUpdate.mockResolvedValue(updatedDoc);

      const result = await repo.appendMessage("user-1", "conv-1", "assistant", "I recommend the blue jacket!");

      expect(result).not.toBeNull();
      expect(result?.messages[1]?.role).toBe("assistant");
      expect(result?.messages[1]?.content).toBe("I recommend the blue jacket!");
    });

    it("returns null when conversation not found (prevents cross-user session hijack)", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(null);

      const result = await repo.appendMessage("user-2", "conv-1", "user", "Trying to access another user's chat");

      expect(result).toBeNull();
      expect(mockCollection.insertOne).not.toHaveBeenCalled();
    });

    it("returns null for a nonexistent conversationId", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(null);

      const result = await repo.appendMessage("user-1", "nonexistent-conv", "user", "Hello?");

      expect(result).toBeNull();
    });

    it("queries by both conversationId and userId to prevent session collisions", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc());

      await repo.appendMessage("user-1", "conv-1", "user", "New message");

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "conv-1", userId: "user-1" },
        expect.objectContaining({
          $push: expect.objectContaining({ messages: expect.any(Object) }),
          $set: expect.objectContaining({ updatedAt: expect.any(String), lastMessageAt: expect.any(String) })
        }),
        { returnDocument: "after" }
      );
    });
  });

  describe("listByUser", () => {
    it("returns all conversations for a user", async () => {
      const repo = makeRepo();
      const docs = [
        makeDoc({ _id: "conv-1", title: "Chat 1" }),
        makeDoc({ _id: "conv-2", title: "Chat 2" })
      ];
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs)
      });

      const result = await repo.listByUser("user-1");

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe("conv-1");
      expect(result[1]?.id).toBe("conv-2");
    });

    it("returns an empty array when user has no conversations", async () => {
      const repo = makeRepo();
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([])
      });

      const result = await repo.listByUser("user-with-no-chats");

      expect(result).toEqual([]);
    });

    it("includes lastMessagePreview in each summary", async () => {
      const repo = makeRepo();
      const doc = makeDoc({
        messages: [
          { id: "msg-1", role: "user", content: "What outfit should I wear?", createdAt: "2026-01-01T00:00:00.000Z" }
        ]
      });
      mockCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([doc])
      });

      const result = await repo.listByUser("user-1");

      expect(result[0]?.lastMessagePreview).toBe("What outfit should I wear?");
      expect(result[0]?.messageCount).toBe(1);
    });
  });

  describe("findById", () => {
    it("returns the conversation record when found", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(makeDoc());

      const result = await repo.findById("user-1", "conv-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("conv-1");
      expect(result?.userId).toBe("user-1");
      expect(result?.messages).toHaveLength(1);
    });

    it("returns null when conversation does not exist", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);

      const result = await repo.findById("user-1", "nonexistent");

      expect(result).toBeNull();
    });

    it("does not return a conversation belonging to a different user", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);

      const result = await repo.findById("user-2", "conv-1");

      expect(result).toBeNull();
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: "conv-1", userId: "user-2" });
    });
  });

  describe("deleteById", () => {
    it("returns true when conversation is deleted", async () => {
      const repo = makeRepo();
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await repo.deleteById("user-1", "conv-1");

      expect(result).toBe(true);
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: "conv-1", userId: "user-1" });
    });

    it("returns false when conversation not found", async () => {
      const repo = makeRepo();
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });

      const result = await repo.deleteById("user-1", "nonexistent");

      expect(result).toBe(false);
    });
  });
});
