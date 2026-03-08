import crypto from "node:crypto";
import { Collection, MongoClient } from "mongodb";
import type { GenerationRecord } from "../types/domain.js";

interface GenerationDocument {
  _id: string;
  userId: string;
  clothingItemIds: string[];
  generatedImageUrl: string;
  createdAt: string;
}

interface GenerationRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  collectionName: string;
}

function toGenerationRecord(document: GenerationDocument): GenerationRecord {
  return {
    id: document._id,
    userId: document.userId,
    clothingItemIds: document.clothingItemIds,
    generatedImageUrl: document.generatedImageUrl,
    createdAt: document.createdAt
  };
}

export class GenerationRepository {
  private readonly client: MongoClient;
  private collectionPromise: Promise<Collection<GenerationDocument>> | null = null;

  constructor(private readonly options: GenerationRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000
    });
  }

  private async getCollection(): Promise<Collection<GenerationDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.initializeCollection();
    }
    return this.collectionPromise;
  }

  private async initializeCollection(): Promise<Collection<GenerationDocument>> {
    await this.client.connect();
    const collection = this.client
      .db(this.options.databaseName)
      .collection<GenerationDocument>(this.options.collectionName);
    await collection.createIndex({ userId: 1, createdAt: -1 }, { name: "user_created_at" });
    return collection;
  }

  async create(userId: string, clothingItemIds: string[], generatedImageUrl: string): Promise<GenerationRecord> {
    const document: GenerationDocument = {
      _id: crypto.randomUUID(),
      userId,
      clothingItemIds,
      generatedImageUrl,
      createdAt: new Date().toISOString()
    };
    const collection = await this.getCollection();
    await collection.insertOne(document);
    return toGenerationRecord(document);
  }
}
