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

  describe("accessoryMode persistence", () => {
    it("defaults accessoryMode to 'auto' for new conversations", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result = await repo.createWithFirstUserMessage("user-1", "Hello");

      expect(result.accessoryMode).toBe("auto");
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ accessoryMode: "auto" })
      );
    });

    it("persists an explicit accessoryMode when provided at creation", async () => {
      const repo = makeRepo();
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true });

      const result = await repo.createWithFirstUserMessage("user-1", "No accessories", "exclude");

      expect(result.accessoryMode).toBe("exclude");
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ accessoryMode: "exclude" })
      );
    });

    it("defaults accessoryMode to 'auto' when reading a legacy doc without the field", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(makeDoc());

      const result = await repo.findById("user-1", "conv-1");

      expect(result?.accessoryMode).toBe("auto");
    });

    it("surfaces stored accessoryMode from the document", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(makeDoc({ accessoryMode: "include" }));

      const result = await repo.findById("user-1", "conv-1");

      expect(result?.accessoryMode).toBe("include");
    });

    it("surfaces a stored pendingConfirmation", async () => {
      const repo = makeRepo();
      const pending = {
        type: "accessoryMode" as const,
        requestedMode: "exclude" as const,
        createdAt: "2026-04-16T00:00:00.000Z"
      };
      mockCollection.findOne.mockResolvedValue(makeDoc({ pendingConfirmation: pending }));

      const result = await repo.findById("user-1", "conv-1");

      expect(result?.pendingConfirmation).toEqual(pending);
    });
  });

  describe("updateConversationFields", () => {
    it("sets accessoryMode via $set with a refreshed updatedAt", async () => {
      const repo = makeRepo();
      const updated = makeDoc({ accessoryMode: "exclude", updatedAt: "2026-04-17T00:00:00.000Z" });
      mockCollection.findOneAndUpdate.mockResolvedValue(updated);

      const result = await repo.updateConversationFields("user-1", "conv-1", { accessoryMode: "exclude" });

      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "conv-1", userId: "user-1" },
        expect.objectContaining({
          $set: expect.objectContaining({ accessoryMode: "exclude", updatedAt: expect.any(String) })
        }),
        { returnDocument: "after" }
      );
      expect(result?.accessoryMode).toBe("exclude");
    });

    it("clears pendingConfirmation via $unset when null is passed", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc({ accessoryMode: "exclude" }));

      await repo.updateConversationFields("user-1", "conv-1", {
        accessoryMode: "exclude",
        pendingConfirmation: null
      });

      const call = mockCollection.findOneAndUpdate.mock.calls[0];
      const update = call?.[1] as { $set?: unknown; $unset?: Record<string, string> };
      expect(update.$unset).toEqual({ pendingConfirmation: "" });
      expect((update.$set as Record<string, unknown>).accessoryMode).toBe("exclude");
    });

    it("stores a pendingConfirmation via $set when an object is passed", async () => {
      const repo = makeRepo();
      const pending = {
        type: "accessoryMode" as const,
        requestedMode: "include" as const,
        createdAt: "2026-04-17T00:00:00.000Z"
      };
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc({ pendingConfirmation: pending }));

      await repo.updateConversationFields("user-1", "conv-1", { pendingConfirmation: pending });

      const call = mockCollection.findOneAndUpdate.mock.calls[0];
      const update = call?.[1] as { $set?: Record<string, unknown>; $unset?: Record<string, string> };
      expect(update.$set?.pendingConfirmation).toEqual(pending);
      expect(update.$unset).toBeUndefined();
    });

    it("returns null when the conversation does not exist", async () => {
      const repo = makeRepo();
      mockCollection.findOneAndUpdate.mockResolvedValue(null);

      const result = await repo.updateConversationFields("user-1", "missing", { accessoryMode: "auto" });

      expect(result).toBeNull();
    });

    it("returns the current record without writing when no updates are requested", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(makeDoc({ accessoryMode: "auto" }));

      const result = await repo.updateConversationFields("user-1", "conv-1", {});

      expect(mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result?.accessoryMode).toBe("auto");
    });

    it("stores pendingConfirmation of type addAccessoriesOffer", async () => {
      const repo = makeRepo();
      const pending = { type: "addAccessoriesOffer" as const, createdAt: "2026-04-18T00:00:00.000Z" };
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc({ pendingConfirmation: pending }));

      await repo.updateConversationFields("user-1", "conv-1", { pendingConfirmation: pending });

      const update = mockCollection.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
      expect(update.$set.pendingConfirmation).toEqual(pending);
    });

    it("stores pendingConfirmation of type futureAccessoryMode", async () => {
      const repo = makeRepo();
      const pending = { type: "futureAccessoryMode" as const, createdAt: "2026-04-18T00:00:00.000Z" };
      mockCollection.findOneAndUpdate.mockResolvedValue(makeDoc({ pendingConfirmation: pending }));

      await repo.updateConversationFields("user-1", "conv-1", { pendingConfirmation: pending });

      const update = mockCollection.findOneAndUpdate.mock.calls[0]?.[1] as { $set: Record<string, unknown> };
      expect(update.$set.pendingConfirmation).toEqual(pending);
    });
  });

  describe("findLatestAssistantRecommendationMessage", () => {
    it("returns the most recent assistant message with recommendationIds", async () => {
      const repo = makeRepo();
      const doc = makeDoc({
        messages: [
          { id: "msg-1", role: "user", content: "outfit please", createdAt: "2026-04-18T00:00:00.000Z" },
          {
            id: "msg-2",
            role: "assistant",
            content: "old rec",
            createdAt: "2026-04-18T00:00:01.000Z",
            recommendationIds: ["rec-old-1"]
          },
          { id: "msg-3", role: "user", content: "another", createdAt: "2026-04-18T00:00:02.000Z" },
          {
            id: "msg-4",
            role: "assistant",
            content: "new rec",
            createdAt: "2026-04-18T00:00:03.000Z",
            recommendationIds: ["rec-new-1", "rec-new-2", "rec-new-3"]
          },
          { id: "msg-5", role: "user", content: "follow-up", createdAt: "2026-04-18T00:00:04.000Z" }
        ]
      });
      mockCollection.findOne.mockResolvedValue(doc);

      const result = await repo.findLatestAssistantRecommendationMessage("user-1", "conv-1");

      expect(result).toEqual({ messageId: "msg-4", recommendationIds: ["rec-new-1", "rec-new-2", "rec-new-3"] });
    });

    it("returns null when no assistant message has recommendationIds", async () => {
      const repo = makeRepo();
      const doc = makeDoc({
        messages: [
          { id: "msg-1", role: "user", content: "hi", createdAt: "2026-04-18T00:00:00.000Z" },
          { id: "msg-2", role: "assistant", content: "plain text reply", createdAt: "2026-04-18T00:00:01.000Z" }
        ]
      });
      mockCollection.findOne.mockResolvedValue(doc);

      const result = await repo.findLatestAssistantRecommendationMessage("user-1", "conv-1");

      expect(result).toBeNull();
    });

    it("returns null when the conversation does not exist", async () => {
      const repo = makeRepo();
      mockCollection.findOne.mockResolvedValue(null);

      const result = await repo.findLatestAssistantRecommendationMessage("user-1", "missing");

      expect(result).toBeNull();
    });

    it("skips assistant messages with empty recommendationIds arrays", async () => {
      const repo = makeRepo();
      const doc = makeDoc({
        messages: [
          {
            id: "msg-2",
            role: "assistant",
            content: "has recs",
            createdAt: "2026-04-18T00:00:01.000Z",
            recommendationIds: ["rec-1"]
          },
          {
            id: "msg-3",
            role: "assistant",
            content: "no recs",
            createdAt: "2026-04-18T00:00:02.000Z",
            recommendationIds: []
          }
        ]
      });
      mockCollection.findOne.mockResolvedValue(doc);

      const result = await repo.findLatestAssistantRecommendationMessage("user-1", "conv-1");

      expect(result).toEqual({ messageId: "msg-2", recommendationIds: ["rec-1"] });
    });
  });
});
