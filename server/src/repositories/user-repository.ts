import crypto from "node:crypto";
import { Collection, MongoClient } from "mongodb";
import type { GoogleIdentity, UserProfile, UserRecord } from "../types/domain.js";

function nowIsoString(): string {
  return new Date().toISOString();
}

interface UserDocument {
  _id: string;
  googleSub: string;
  email: string;
  name: string;
  picture: string | null;
  profile: UserProfile | null;
  createdAt: string;
  updatedAt: string;
}

interface UserRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  collectionName: string;
}

function toUserRecord(document: UserDocument): UserRecord {
  return {
    id: document._id,
    googleSub: document.googleSub,
    email: document.email,
    name: document.name,
    picture: document.picture,
    profile: document.profile,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const withCode = error as { code?: unknown };
  return withCode.code === 11000;
}

export class UserRepository {
  private readonly client: MongoClient;
  private collectionPromise: Promise<Collection<UserDocument>> | null = null;

  constructor(private readonly options: UserRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000
    });
  }

  private async getCollection(): Promise<Collection<UserDocument>> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.initializeCollection();
    }

    return this.collectionPromise;
  }

  private async initializeCollection(): Promise<Collection<UserDocument>> {
    await this.client.connect();
    const collection = this.client.db(this.options.databaseName).collection<UserDocument>(this.options.collectionName);
    await collection.createIndex({ googleSub: 1 }, { unique: true, name: "uniq_google_sub" });
    await collection.createIndex({ email: 1 }, { unique: true, name: "uniq_email" });
    return collection;
  }

  async findById(userId: string): Promise<UserRecord | null> {
    const collection = await this.getCollection();
    const user = await collection.findOne({ _id: userId });
    return user ? toUserRecord(user) : null;
  }

  async upsertFromGoogleIdentity(identity: GoogleIdentity): Promise<UserRecord> {
    const collection = await this.getCollection();
    const normalizedEmail = identity.email.toLowerCase();
    const now = nowIsoString();

    const existingUser =
      (await collection.findOne({ googleSub: identity.sub })) ?? (await collection.findOne({ email: normalizedEmail }));

    if (existingUser) {
      const updatedUser: UserDocument = {
        ...existingUser,
        googleSub: identity.sub,
        email: normalizedEmail,
        name: identity.name || existingUser.name,
        picture: identity.picture,
        updatedAt: now
      };

      await collection.replaceOne({ _id: existingUser._id }, updatedUser);
      return toUserRecord(updatedUser);
    }

    const createdUser: UserDocument = {
      _id: crypto.randomUUID(),
      googleSub: identity.sub,
      email: normalizedEmail,
      name: identity.name,
      picture: identity.picture,
      profile: null,
      createdAt: now,
      updatedAt: now
    };

    try {
      await collection.insertOne(createdUser);
      return toUserRecord(createdUser);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const concurrentUser =
        (await collection.findOne({ googleSub: identity.sub })) ?? (await collection.findOne({ email: normalizedEmail }));

      if (!concurrentUser) {
        throw error;
        
      }

      const reconciledUser: UserDocument = {
        ...concurrentUser,
        googleSub: identity.sub,
        email: normalizedEmail,
        name: identity.name || concurrentUser.name,
        picture: identity.picture,
        updatedAt: now
      };

      await collection.replaceOne({ _id: concurrentUser._id }, reconciledUser);
      return toUserRecord(reconciledUser);
    }
  }

  async updateProfile(userId: string, profile: UserProfile): Promise<UserRecord | null> {
    const collection = await this.getCollection();
    const now = nowIsoString();
    const updatedUser = await collection.findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          profile,
          name: profile.name,
          updatedAt: now
        }
      },
      {
        returnDocument: "after"
      }
    );

    if (!updatedUser) {
      return null;
    }

    return toUserRecord(updatedUser);
  }
}
