import crypto from "node:crypto";
import { Collection, MongoClient } from "mongodb";
import type {
  RecommendationGeneration,
  RecommendationItem,
  RecommendationRecord,
  RecommendationVote
} from "../types/domain.js";

interface RecommendationDocument {
  _id: string;
  userId: string;
  outfitName: string;
  reason: string;
  items: RecommendationItem[];
  occasions: string[];
  weather?: string | null;
  generation: RecommendationGeneration | null;
  vote: RecommendationVote | null;
  conversationId: string;
  messageId: string;
  createdAt: string;
  updatedAt: string;
}

interface RecommendationRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  collectionName: string;
}

interface CreateRecommendationInput {
  userId: string;
  outfitName: string;
  reason: string;
  items: RecommendationItem[];
  occasions: string[];
  weather: string | null;
  conversationId: string;
  messageId: string;
}

function toRecommendationRecord(document: RecommendationDocument): RecommendationRecord {
  return {
    id: document._id,
    userId: document.userId,
    outfitName: document.outfitName,
    reason: document.reason,
    items: document.items,
    occasions: document.occasions,
    weather: document.weather ?? null,
    generation: document.generation,
    vote: document.vote,
    conversationId: document.conversationId,
    messageId: document.messageId,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

export class RecommendationRepository {
  private readonly client: MongoClient;
  private collectionPromise: Promise<Collection<RecommendationDocument>> | null = null;

  constructor(private readonly options: RecommendationRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000
    });
  }

  private async getCollection(): Promise<Collection<RecommendationDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.initializeCollection();
    }
    return this.collectionPromise;
  }

  private async initializeCollection(): Promise<Collection<RecommendationDocument>> {
    await this.client.connect();
    const collection = this.client
      .db(this.options.databaseName)
      .collection<RecommendationDocument>(this.options.collectionName);
    await collection.createIndex({ userId: 1, createdAt: -1 }, { name: "user_created_at" });
    await collection.createIndex({ userId: 1, conversationId: 1 }, { name: "user_conversation" });
    await collection.createIndex({ conversationId: 1, messageId: 1 }, { name: "conversation_message" });
    return collection;
  }

  async create(input: CreateRecommendationInput): Promise<RecommendationRecord> {
    const now = new Date().toISOString();
    const document: RecommendationDocument = {
      _id: crypto.randomUUID(),
      userId: input.userId,
      outfitName: input.outfitName,
      reason: input.reason,
      items: input.items,
      occasions: input.occasions,
      weather: input.weather,
      generation: null,
      vote: null,
      conversationId: input.conversationId,
      messageId: input.messageId,
      createdAt: now,
      updatedAt: now
    };
    const collection = await this.getCollection();
    await collection.insertOne(document);
    return toRecommendationRecord(document);
  }

  async createMany(inputs: CreateRecommendationInput[]): Promise<RecommendationRecord[]> {
    if (inputs.length === 0) return [];

    const now = new Date().toISOString();
    const documents: RecommendationDocument[] = inputs.map((input) => ({
      _id: crypto.randomUUID(),
      userId: input.userId,
      outfitName: input.outfitName,
      reason: input.reason,
      items: input.items,
      occasions: input.occasions,
      weather: input.weather,
      generation: null,
      vote: null,
      conversationId: input.conversationId,
      messageId: input.messageId,
      createdAt: now,
      updatedAt: now
    }));

    const collection = await this.getCollection();
    await collection.insertMany(documents);
    return documents.map(toRecommendationRecord);
  }

  async findById(userId: string, recommendationId: string): Promise<RecommendationRecord | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ _id: recommendationId, userId });
    return document ? toRecommendationRecord(document) : null;
  }

  async listByUser(userId: string, limit = 100): Promise<RecommendationRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return documents.map(toRecommendationRecord);
  }

  async findByMessage(conversationId: string, messageId: string): Promise<RecommendationRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection
      .find({ conversationId, messageId })
      .sort({ createdAt: 1 })
      .toArray();
    return documents.map(toRecommendationRecord);
  }

  async deleteByConversation(userId: string, conversationId: string): Promise<number> {
    const collection = await this.getCollection();
    const result = await collection.deleteMany({ userId, conversationId });
    return result.deletedCount ?? 0;
  }

  async updateGeneration(
    userId: string,
    recommendationId: string,
    generation: RecommendationGeneration
  ): Promise<RecommendationRecord | null> {
    const collection = await this.getCollection();
    const updated = await collection.findOneAndUpdate(
      { _id: recommendationId, userId },
      { $set: { generation, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    return updated ? toRecommendationRecord(updated) : null;
  }

  async updateVote(
    userId: string,
    recommendationId: string,
    vote: RecommendationVote | null
  ): Promise<RecommendationRecord | null> {
    const collection = await this.getCollection();
    const updated = await collection.findOneAndUpdate(
      { _id: recommendationId, userId },
      { $set: { vote, updatedAt: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    return updated ? toRecommendationRecord(updated) : null;
  }

  async findVotedByUser(userId: string): Promise<RecommendationRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection
      .find({ userId, vote: { $in: ["up", "down"] } })
      .sort({ updatedAt: -1 })
      .toArray();
    return documents.map(toRecommendationRecord);
  }
}
