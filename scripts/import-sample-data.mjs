/**
 * Import sample clothing data into MongoDB for a specific user.
 * Usage: node scripts/import-sample-data.mjs <your-email>
 *
 * Example: node scripts/import-sample-data.mjs yourname@gmail.com
 */

import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envPath = resolve(__dirname, "../server/.env");
const envContent = readFileSync(envPath, "utf8");
const env = {};
for (const line of envContent.split("\n")) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) env[key.trim()] = rest.join("=").trim();
}

const MONGODB_URI = env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = env.MONGODB_DB_NAME || "wearwise";
const USERS_COLLECTION = env.MONGODB_USERS_COLLECTION || "users";
const CLOSET_COLLECTION = env.MONGODB_CLOSET_COLLECTION || "closet_items";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/import-sample-data.mjs <your-email>");
  process.exit(1);
}

// All sample data files to import
const sampleFiles = [
  "client/public/sample-data/sample-clothes-data.json",
  "client/public/sample-data/sample-accessories-data.json",
];

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

try {
  await client.connect();
  const db = client.db(DB_NAME);

  // Find user by email
  const user = await db.collection(USERS_COLLECTION).findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`User not found for email: ${email}`);
    console.error("Make sure you have logged in at least once before running this script.");
    process.exit(1);
  }

  const userId = user._id;
  console.log(`Found user: ${user.name} (${user.email}) — ID: ${userId}\n`);

  let totalInserted = 0;

  for (const relPath of sampleFiles) {
    const filePath = resolve(__dirname, "..", relPath);
    if (!existsSync(filePath)) {
      console.log(`⚠️  Skipping (not found): ${relPath}`);
      continue;
    }

    const items = JSON.parse(readFileSync(filePath, "utf8"));
    const now = new Date().toISOString();

    const documents = items.map((item) => ({
      _id: crypto.randomUUID(),
      userId,
      imageUrl: item.imageUrl,
      analysisStatus: item.analysisStatus ?? "ready",
      analysisError: item.analysisError ?? null,
      name: item.name ?? null,
      category: item.category ?? null,
      tags: item.tags ?? [],
      description: item.description ?? null,
      createdAt: item.createdAt ?? now,
      updatedAt: item.updatedAt ?? now,
    }));

    const result = await db.collection(CLOSET_COLLECTION).insertMany(documents);
    console.log(`✅ ${relPath.split("/").pop()}: inserted ${result.insertedCount} items`);
    totalInserted += result.insertedCount;
  }

  console.log(`\n🎉 Total inserted: ${totalInserted} items`);

} catch (err) {
  console.error("Error:", err.message);
} finally {
  await client.close();
}
