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
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

interface ImportedClosetItemInput {
  imageUrl: string;
  analysisStatus: ClosetItemStatus;
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt?: string | null | undefined;
  updatedAt?: string | null | undefined;
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

  async importMany(userId: string, items: ImportedClosetItemInput[]): Promise<ClosetItemRecord[]> {
    if (items.length === 0) {
      return [];
    }

    const collection = await this.getCollection();
    const documents: ClosetItemDocument[] = items.map((item) => {
      const createdAt = item.createdAt?.trim() ? item.createdAt : nowIsoString();
      const updatedAt = item.updatedAt?.trim() ? item.updatedAt : createdAt;

      return {
        _id: crypto.randomUUID(),
        userId,
        imageUrl: item.imageUrl,
        analysisStatus: item.analysisStatus,
        analysisError: item.analysisError ?? null,
        name: item.name ?? null,
        category: item.category ?? null,
        tags: item.tags,
        description: item.description ?? null,
        createdAt,
        updatedAt
      };
    });

    await collection.insertMany(documents);
    return documents.map(toClosetItemRecord);
  }

  async findById(userId: string, itemId: string): Promise<ClosetItemRecord | null> {
    const collection = await this.getCollection();
    const document = await collection.findOne({ _id: itemId, userId });
    return document ? toClosetItemRecord(document) : null;
  }

  async listByUser(userId: string, limit = 150): Promise<ClosetItemRecord[]> {
    const collection = await this.getCollection();
    const documents = await collection.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return documents.map(toClosetItemRecord);
  }

  async updateMetadata(
    userId: string,
    itemId: string,
    update: {
      name?: string;
      category?: string;
      tags?: string[];
      description?: string;
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

  async updateEmbedding(userId: string, itemId: string, embedding: number[]): Promise<void> {
    const collection = await this.getCollection();
    await collection.updateOne(
      { _id: itemId, userId },
      { $set: { embedding, updatedAt: nowIsoString() } }
    );
  }

  /**
   * Performs a semantic vector search over the user's closet items using MongoDB Atlas
   * Vector Search. The collection must have a vector index named "closet_vector_index"
   * with path "embedding", numDimensions 768, similarity "cosine", and filter paths
   * "userId" and "analysisStatus". Falls back to an empty array on error so callers
   * can degrade gracefully to a regular listByUser query.
   */
  async vectorSearch(
    userId: string,
    queryEmbedding: number[],
    options: { limit?: number; excludeIds?: string[] } = {}
  ): Promise<ClosetItemRecord[]> {
    const { limit = 25, excludeIds = [] } = options;
    const collection = await this.getCollection();

    // numCandidates must be >= limit; use 10× for better recall
    const numCandidates = Math.max(limit * 10, 100);

    const pipeline: object[] = [
      {
        $vectorSearch: {
          index: "closet_vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates,
          limit: limit + excludeIds.length,
          filter: { userId, analysisStatus: "ready" }
        }
      }
    ];

    if (excludeIds.length > 0) {
      pipeline.push({ $match: { _id: { $nin: excludeIds } } });
      pipeline.push({ $limit: limit });
    }

    const documents = await collection.aggregate<ClosetItemDocument>(pipeline).toArray();
    return documents.map(toClosetItemRecord);
  }
}
