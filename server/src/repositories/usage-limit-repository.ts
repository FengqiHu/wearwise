import { Collection, MongoClient } from "mongodb";

interface UsageLimitDocument {
  _id: string; // `${userId}:${action}:${dateKey}`
  userId: string;
  action: string;
  dateKey: string; // YYYY-MM-DD UTC
  count: number;
  expiresAt: Date;
}

interface UsageLimitRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  collectionName: string;
}

export class UsageLimitRepository {
  private readonly client: MongoClient;
  private collectionPromise: Promise<Collection<UsageLimitDocument>> | null = null;

  constructor(private readonly options: UsageLimitRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
    });
  }

  private async getCollection(): Promise<Collection<UsageLimitDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.initializeCollection();
    }
    return this.collectionPromise;
  }

  private async initializeCollection(): Promise<Collection<UsageLimitDocument>> {
    await this.client.connect();
    const collection = this.client
      .db(this.options.databaseName)
      .collection<UsageLimitDocument>(this.options.collectionName);

    // Auto-expire documents after their expiresAt date
    await collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: "ttl_expires_at" }
    );

    return collection;
  }

  // Atomically increment and return the new count
  async incrementAndGet(userId: string, action: string, dateKey: string): Promise<number> {
    const collection = await this.getCollection();
    const id = `${userId}:${action}:${dateKey}`;

    // Expire 2 days after the tracked date
    const parts = dateKey.split("-").map(Number);
    const expiresAt = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]! + 2));

    const result = await collection.findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: { userId, action, dateKey, expiresAt },
      },
      { upsert: true, returnDocument: "after" }
    );

    return result!.count;
  }
}
