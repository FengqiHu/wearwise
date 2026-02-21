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

export const env = {
  port: Number.parseInt(process.env.PORT ?? "3001", 10),
  corsOrigin: clientOrigin
    ? clientOrigin
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : true,
  openaiApiKey: getEnv("OPENAI_API_KEY"),
  googleClientId: googleClientIdFromEnv || getEnv("VITE_GOOGLE_CLIENT_ID"),
  googleClientSecret: getEnv("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: getEnv("GOOGLE_REDIRECT_URI"),
  sessionSecret: getEnv("AUTH_SESSION_SECRET") || "dev-only-session-secret-change-me",
  sessionTtlSeconds: parseSessionTtlSeconds(),
  mongoUri,
  mongoDatabaseName,
  mongoUsersCollection,
  mongoConversationsCollection
};
