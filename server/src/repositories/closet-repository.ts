import crypto from "node:crypto";
import { Collection, MongoClient } from "mongodb";
import type { ClosetItemRecord, ClosetItemStatus } from "../types/domain.js";

interface ClosetItemDocument {
  _id: string;
  userId: string;
  imageUrl: string;
  analysisStatus: ClosetItemStatus;
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClosetRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  collectionName: string;
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function toClosetItemRecord(document: ClosetItemDocument): ClosetItemRecord {
  return {
    id: document._id,
    userId: document.userId,
    imageUrl: document.imageUrl,
    analysisStatus: document.analysisStatus,
    analysisError: document.analysisError ?? null,
    name: document.name,
    category: document.category,
    tags: document.tags,
    description: document.description,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

export class ClosetRepository {
  private readonly client: MongoClient;
  private collectionPromise: Promise<Collection<ClosetItemDocument>> | null = null;

  constructor(private readonly options: ClosetRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000
    });
  }

  private async getCollection(): Promise<Collection<ClosetItemDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.initializeCollection();
    }
    return this.collectionPromise;
  }

  private async initializeCollection(): Promise<Collection<ClosetItemDocument>> {
    await this.client.connect();
    const collection = this.client
      .db(this.options.databaseName)
      .collection<ClosetItemDocument>(this.options.collectionName);
    await collection.createIndex({ userId: 1, createdAt: -1 }, { name: "user_created_at" });
    return collection;
  }

  async create(userId: string, imageUrl: string): Promise<ClosetItemRecord> {
    const now = nowIsoString();
    const document: ClosetItemDocument = {
      _id: crypto.randomUUID(),
      userId,
      imageUrl,
      analysisStatus: "pending",
      analysisError: null,
      name: null,
      category: null,
      tags: [],
      description: null,
      createdAt: now,
      updatedAt: now
    };
    const collection = await this.getCollection();
    await collection.insertOne(document);
    return toClosetItemRecord(document);
  }

  async findById(userId: string, itemId: string): Promise<ClosetItemRecord | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ _id: itemId, userId });
    return document ? toClosetItemRecord(document) : null;
  }

  async listByUser(userId: string, limit = 40): Promise<ClosetItemRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return documents.map(toClosetItemRecord);
  }

  async deleteById(userId: string, itemId: string): Promise<boolean> {
    const collection = await this.getCollection();
    const result = await collection.deleteOne({ _id: itemId, userId });
    return result.deletedCount === 1;
  }

  async updateImage(userId: string, itemId: string, newImageUrl: string): Promise<ClosetItemRecord | null> {
    const collection = await this.getCollection();
    const result = await collection.findOneAndUpdate(
      { _id: itemId, userId },
      {
        $set: {
          imageUrl: newImageUrl,
          analysisStatus: "pending",
          analysisError: null,
          name: null,
          category: null,
          tags: [],
          description: null,
          updatedAt: nowIsoString()
        }
      },
      { returnDocument: "after" }
    );
    return result ? toClosetItemRecord(result) : null;
  }

  async updateExtraction(
    userId: string,
    itemId: string,
    update: {
      analysisStatus: ClosetItemStatus;
      analysisError?: string | null;
      name?: string | null;
      category?: string | null;
      tags?: string[];
      description?: string | null;
    }
  ): Promise<ClosetItemRecord | null> {
    const collection = await this.getCollection();
    const result = await collection.findOneAndUpdate(
      { _id: itemId, userId },
      { $set: { ...update, updatedAt: nowIsoString() } },
      { returnDocument: "after" }
    );
    return result ? toClosetItemRecord(result) : null;
  }
}
