import crypto from "node:crypto";
import { Collection, MongoClient } from "mongodb";
import type {
  AccessoryMode,
  ChatRole,
  ConversationRecord,
  ConversationSummary,
  PendingConfirmation,
  StoredChatMessage
} from "../types/domain.js";

interface ConversationDocument {
  _id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messages: StoredChatMessage[];
  accessoryMode?: AccessoryMode;
  pendingConfirmation?: PendingConfirmation;
}

export interface ConversationFieldUpdates {
  accessoryMode?: AccessoryMode;
  // null explicitly clears the pending confirmation; undefined leaves it untouched.
  pendingConfirmation?: PendingConfirmation | null;
}

interface ConversationRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  collectionName: string;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createConversationTitle(firstMessage: string): string {
  const normalized = normalizeText(firstMessage);

  if (!normalized) {
    return "New chat";
  }

  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 45)}...`;
}

function toConversationRecord(document: ConversationDocument): ConversationRecord {
  const base: ConversationRecord = {
    id: document._id,
    userId: document.userId,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    lastMessageAt: document.lastMessageAt,
    messages: document.messages,
    accessoryMode: document.accessoryMode ?? "auto"
  };
  if (document.pendingConfirmation) {
    base.pendingConfirmation = document.pendingConfirmation;
  }
  return base;
}

function toConversationSummary(document: ConversationDocument): ConversationSummary {
  const lastMessage = document.messages[document.messages.length - 1];
  const lastMessagePreview = lastMessage ? normalizeText(lastMessage.content).slice(0, 120) : "";

  return {
    id: document._id,
    title: document.title,
    updatedAt: document.updatedAt,
    lastMessageAt: document.lastMessageAt,
    lastMessagePreview,
    messageCount: document.messages.length
  };
}

export class ConversationRepository {
  private readonly client: MongoClient;
  private collectionPromise: Promise<Collection<ConversationDocument>> | null = null;

  constructor(private readonly options: ConversationRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000
    });
  }

  private async getCollection(): Promise<Collection<ConversationDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.initializeCollection();
    }

    return this.collectionPromise;
  }

  private async initializeCollection(): Promise<Collection<ConversationDocument>> {
    await this.client.connect();
    const collection = this.client.db(this.options.databaseName).collection<ConversationDocument>(this.options.collectionName);
    await collection.createIndex({ userId: 1, lastMessageAt: -1 }, { name: "user_last_message_at" });
    await collection.createIndex({ userId: 1, updatedAt: -1 }, { name: "user_updated_at" });
    return collection;
  }

  private createMessage(role: ChatRole, content: string): StoredChatMessage {
    return {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: nowIsoString()
    };
  }

  async listByUser(userId: string, limit = 40): Promise<ConversationSummary[]> {
    const collection = await this.getCollection();
    const documents = await collection.find({ userId }).sort({ lastMessageAt: -1 }).limit(limit).toArray();
    return documents.map(toConversationSummary);
  }

  async findById(userId: string, conversationId: string): Promise<ConversationRecord | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ _id: conversationId, userId });
    return document ? toConversationRecord(document) : null;
  }

  async deleteById(userId: string, conversationId: string): Promise<boolean> {
    const collection = await this.getCollection();
    const result = await collection.deleteOne({
      _id: conversationId,
      userId
    });
    return result.deletedCount === 1;
  }

  async createWithFirstUserMessage(
    userId: string,
    messageContent: string,
    accessoryMode: AccessoryMode = "auto"
  ): Promise<ConversationRecord> {
    const now = nowIsoString();
    const userMessage = this.createMessage("user", messageContent);
    const document: ConversationDocument = {
      _id: crypto.randomUUID(),
      userId,
      title: createConversationTitle(messageContent),
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messages: [userMessage],
      accessoryMode
    };

    const collection = await this.getCollection();
    await collection.insertOne(document);
    return toConversationRecord(document);
  }

  async appendMessage(userId: string, conversationId: string, role: ChatRole, content: string): Promise<ConversationRecord | null> {
    const collection = await this.getCollection();
    const now = nowIsoString();
    const message = this.createMessage(role, content);
    const updated = await collection.findOneAndUpdate(
      {
        _id: conversationId,
        userId
      },
      {
        $push: {
          messages: message
        },
        $set: {
          updatedAt: now,
          lastMessageAt: now
        }
      },
      {
        returnDocument: "after"
      }
    );

    if (!updated) {
      return null;
    }

    return toConversationRecord(updated);
  }

  async setMessageRecommendationIds(
    userId: string,
    conversationId: string,
    messageId: string,
    recommendationIds: string[]
  ): Promise<ConversationRecord | null> {
    const collection = await this.getCollection();
    const conversation = await collection.findOne({ _id: conversationId, userId });
    if (!conversation) return null;

    const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return null;

    const updated = await collection.findOneAndUpdate(
      { _id: conversationId, userId },
      {
        $set: {
          [`messages.${messageIndex}.recommendationIds`]: recommendationIds,
          updatedAt: nowIsoString()
        }
      },
      { returnDocument: "after" }
    );

    return updated ? toConversationRecord(updated) : null;
  }

  async findLatestAssistantRecommendationMessage(
    userId: string,
    conversationId: string
  ): Promise<{ messageId: string; recommendationIds: string[] } | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ _id: conversationId, userId });
    if (!document) return null;

    for (let i = document.messages.length - 1; i >= 0; i--) {
      const message = document.messages[i];
      if (message && message.role === "assistant" && message.recommendationIds && message.recommendationIds.length > 0) {
        return { messageId: message.id, recommendationIds: message.recommendationIds };
      }
    }
    return null;
  }

  async updateConversationFields(
    userId: string,
    conversationId: string,
    updates: ConversationFieldUpdates
  ): Promise<ConversationRecord | null> {
    const set: Partial<ConversationDocument> = { updatedAt: nowIsoString() };
    const unset: Partial<Record<keyof ConversationDocument, "">> = {};

    if (updates.accessoryMode !== undefined) {
      set.accessoryMode = updates.accessoryMode;
    }
    if (updates.pendingConfirmation === null) {
      unset.pendingConfirmation = "";
    } else if (updates.pendingConfirmation !== undefined) {
      set.pendingConfirmation = updates.pendingConfirmation;
    }

    const hasSet = Object.keys(set).length > 1; // always has updatedAt
    const hasUnset = Object.keys(unset).length > 0;
    if (!hasSet && !hasUnset) {
      return this.findById(userId, conversationId);
    }

    const update: Record<string, unknown> = { $set: set };
    if (hasUnset) {
      update.$unset = unset;
    }

    const collection = await this.getCollection();
    const updated = await collection.findOneAndUpdate(
      { _id: conversationId, userId },
      update,
      { returnDocument: "after" }
    );

    return updated ? toConversationRecord(updated) : null;
  }
}
