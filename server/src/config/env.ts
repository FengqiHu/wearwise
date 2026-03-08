import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function sanitizeGoogleClientId(rawClientId: string): string {
  const marker = "GOOGLE_CLIENT_ID=";
  const markerIndex = rawClientId.indexOf(marker);

  if (markerIndex > 0) {
    return rawClientId.slice(0, markerIndex).trim();
  }

  return rawClientId.trim();
}

function parseSessionTtlSeconds(): number {
  const parsed = Number.parseInt(getEnv("AUTH_SESSION_TTL_SECONDS"), 10);

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 60 * 60 * 24 * 7;
}

function stripTrailingSlashes(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, "");
}

const rawGoogleClientId = getEnv("GOOGLE_CLIENT_ID");
const googleClientIdFromEnv = sanitizeGoogleClientId(rawGoogleClientId);

if (rawGoogleClientId && rawGoogleClientId !== googleClientIdFromEnv) {
  console.warn("Detected malformed GOOGLE_CLIENT_ID value and auto-sanitized it. Please update server/.env.");
}

const clientOrigin = getEnv("CLIENT_ORIGIN");
const mongoUri = getEnv("MONGODB_URI") || "mongodb://127.0.0.1:27017";
const mongoDatabaseName = getEnv("MONGODB_DB_NAME") || "wearwise";
const mongoUsersCollection = getEnv("MONGODB_USERS_COLLECTION") || "users";
const mongoConversationsCollection = getEnv("MONGODB_CONVERSATIONS_COLLECTION") || "conversations";
const mongoClosetCollection = getEnv("MONGODB_CLOSET_COLLECTION") || "closet_items";
const mongoGenerationsCollection = getEnv("MONGODB_GENERATIONS_COLLECTION") || "generations";

const s3Bucket = getEnv("S3_BUCKET");
const s3Region = getEnv("S3_REGION") || "auto";
const s3Endpoint = getEnv("S3_ENDPOINT");
const s3AccessKeyId = getEnv("S3_ACCESS_KEY_ID");
const s3SecretAccessKey = getEnv("S3_SECRET_ACCESS_KEY");
const s3PublicBaseUrl = stripTrailingSlashes(getEnv("S3_PUBLIC_BASE_URL"));

export const env = {
  port: Number.parseInt(process.env.PORT ?? "3001", 10),
  corsOrigin: clientOrigin
    ? clientOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true,
  openaiApiKey: getEnv("OPENAI_API_KEY"),
  geminiApiKey: getEnv("GEMINI_API_KEY"),
  googleClientId: googleClientIdFromEnv || getEnv("VITE_GOOGLE_CLIENT_ID"),
  googleClientSecret: getEnv("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: getEnv("GOOGLE_REDIRECT_URI"),
  sessionSecret: getEnv("AUTH_SESSION_SECRET") || "dev-only-session-secret-change-me",
  sessionTtlSeconds: parseSessionTtlSeconds(),
  mongoUri,
  mongoDatabaseName,
  mongoUsersCollection,
  mongoConversationsCollection,
  mongoClosetCollection,
  mongoGenerationsCollection,
  s3Bucket,
  s3Region,
  s3Endpoint,
  s3AccessKeyId,
  s3SecretAccessKey,
  s3PublicBaseUrl
};
