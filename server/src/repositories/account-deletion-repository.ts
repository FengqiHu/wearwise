import { MongoClient } from "mongodb";

interface AccountDeletionRepositoryOptions {
  mongoUri: string;
  databaseName: string;
  usersCollectionName: string;
  closetCollectionName: string;
  conversationsCollectionName: string;
  recommendationsCollectionName: string;
  generationsCollectionName: string;
}

interface UserScopedDocument {
  _id: string;
  userId: string;
}

interface UserDocument {
  _id: string;
}

export class AccountDeletionRepository {
  private readonly client: MongoClient;

  constructor(private readonly options: AccountDeletionRepositoryOptions) {
    this.client = new MongoClient(options.mongoUri, {
      serverSelectionTimeoutMS: 10_000
    });
  }

  async deleteUserData(userId: string): Promise<void> {
    await this.client.connect();

    const session = this.client.startSession();

    try {
      await session.withTransaction(async () => {
        const database = this.client.db(this.options.databaseName);

        await database.collection<UserScopedDocument>(this.options.recommendationsCollectionName).deleteMany({ userId }, { session });
        await database.collection<UserScopedDocument>(this.options.generationsCollectionName).deleteMany({ userId }, { session });
        await database.collection<UserScopedDocument>(this.options.conversationsCollectionName).deleteMany({ userId }, { session });
        await database.collection<UserScopedDocument>(this.options.closetCollectionName).deleteMany({ userId }, { session });

        const result = await database.collection<UserDocument>(this.options.usersCollectionName).deleteOne({ _id: userId }, { session });

        if (result.deletedCount !== 1) {
          throw new Error("User record was not deleted.");
        }
      });
    } finally {
      await session.endSession();
    }
  }
}
