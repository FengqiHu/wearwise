import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { ClosetRepository } from "./repositories/closet-repository.js";
import { ConversationRepository } from "./repositories/conversation-repository.js";
import { GenerationRepository } from "./repositories/generation-repository.js";
import { RecommendationRepository } from "./repositories/recommendation-repository.js";
import { AccountDeletionRepository } from "./repositories/account-deletion-repository.js";
import { UserRepository } from "./repositories/user-repository.js";
import { UsageLimitRepository } from "./repositories/usage-limit-repository.js";
import { createAuthRoutes } from "./routes/auth-routes.js";
import { createChatRoutes } from "./routes/chat-routes.js";
import { createRecommendationRoutes } from "./routes/recommendation-routes.js";
import { createClosetRoutes } from "./routes/closet-routes.js";
import { createGenerationRoutes } from "./routes/generation-routes.js";
import { createShopRoutes } from "./routes/shop-routes.js";
import { createHealthRoutes } from "./routes/health-routes.js";
import { createAccountRoutes } from "./routes/account-routes.js";
import { createProfileRoutes } from "./routes/profile-routes.js";
import { createUploadsRoutes } from "./routes/uploads-routes.js";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
import { GeminiClothingPresenceService } from "./services/gemini-clothing-presence-service.js";
import { GeminiExtractionService } from "./services/gemini-extraction-service.js";
import { GeminiHumanPresenceService } from "./services/gemini-human-presence-service.js";
import { GeminiRecommendationService } from "./services/gemini-recommendation-service.js";
import { GoogleOAuthService } from "./services/google-oauth-service.js";
import { ImageModerationService } from "./services/image-moderation-service.js";
import { ImageGenerationService } from "./services/image-generation-service.js";
import { OpenWeatherService } from "./services/openweather-service.js";
import { R2StorageService } from "./services/r2-storage-service.js";
import { UsageLimitService } from "./services/usage-limit-service.js";
import { createUsageLimitMiddleware } from "./middleware/usage-limit.js";
import { ReviewedImageStorageService } from "./services/reviewed-image-storage-service.js";
import { SessionService } from "./services/session-service.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
      exposedHeaders: ["X-Conversation-Id"]
    })
  );

  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: false, limit: "20mb" }));

  const userRepository = new UserRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    collectionName: env.mongoUsersCollection
  });
  const conversationRepository = new ConversationRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    collectionName: env.mongoConversationsCollection
  });
  const closetRepository = new ClosetRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    collectionName: env.mongoClosetCollection
  });
  const generationRepository = new GenerationRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    collectionName: env.mongoGenerationsCollection
  });
  const recommendationRepository = new RecommendationRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    collectionName: env.mongoRecommendationsCollection
  });
  const usageLimitRepository = new UsageLimitRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    collectionName: env.mongoUsageLimitsCollection
  });
  const accountDeletionRepository = new AccountDeletionRepository({
    mongoUri: env.mongoUri,
    databaseName: env.mongoDatabaseName,
    usersCollectionName: env.mongoUsersCollection,
    closetCollectionName: env.mongoClosetCollection,
    conversationsCollectionName: env.mongoConversationsCollection,
    recommendationsCollectionName: env.mongoRecommendationsCollection,
    generationsCollectionName: env.mongoGenerationsCollection
  });
  const r2StorageService = new R2StorageService({
    bucket: env.s3Bucket,
    region: env.s3Region,
    endpoint: env.s3Endpoint,
    accessKeyId: env.s3AccessKeyId,
    secretAccessKey: env.s3SecretAccessKey,
    publicBaseUrl: env.s3PublicBaseUrl
  });
  const sessionService = new SessionService(env.sessionSecret, env.sessionTtlSeconds);
  const authService = new AuthService(sessionService, userRepository);
  const usageLimitService = new UsageLimitService(usageLimitRepository);
  const openWeatherService = new OpenWeatherService(env.openWeatherApiKey);
  const chatService = new ChatService(env.openaiApiKey, openWeatherService);
  const imageModerationService = new ImageModerationService({
    apiKey: env.googleCloudVisionApiKey,
    timeoutMs: env.uploadModerationTimeoutMs
  });
  const reviewedImageStorageService = new ReviewedImageStorageService(
    r2StorageService,
    imageModerationService,
    new GeminiHumanPresenceService({ apiKey: env.geminiApiKey }),
    new GeminiClothingPresenceService({ apiKey: env.geminiApiKey })
  );
  const geminiExtractionService = new GeminiExtractionService({ apiKey: env.geminiApiKey });
  const geminiRecommendationService = new GeminiRecommendationService({ apiKey: env.geminiApiKey });
  const imageGenerationService = new ImageGenerationService({ apiKey: env.geminiApiKey });
  const googleOAuthService = new GoogleOAuthService({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    defaultRedirectUri: env.googleRedirectUri
  });

  // Per-endpoint daily usage limits for AI-powered routes
  const rateLimit = (action: Parameters<typeof createUsageLimitMiddleware>[2]) =>
    createUsageLimitMiddleware(sessionService, usageLimitService, action);

  app.post("/api/chat", rateLimit("chat_message"));
  app.post("/api/generate/outfit", rateLimit("outfit_generation"));
  app.post("/api/shop/recommend", rateLimit("shop_recommend"));
  app.post("/api/shop/try-on", rateLimit("shop_try_on"));
  app.post("/api/closet/items/:id/analyze", rateLimit("closet_analyze"));
  app.post("/api/closet/recommend", rateLimit("closet_recommend"));

  app.use(
    "/api",
    createAuthRoutes({
      authService,
      googleOAuthService,
      sessionService,
      sessionTtlSeconds: env.sessionTtlSeconds,
      userRepository
    })
  );

  app.use(
    "/api",
    createProfileRoutes({
      authService,
      userRepository,
      r2StorageService
    })
  );

  app.use(
    "/api",
    createAccountRoutes({
      authService,
      closetRepository,
      recommendationRepository,
      generationRepository,
      accountDeletionRepository,
      r2StorageService
    })
  );

  app.use(
    "/api",
    createUploadsRoutes({
      authService,
      reviewedImageStorageService
    })
  );

  app.use(
    "/api",
    createChatRoutes({
      authService,
      conversationRepository,
      recommendationRepository,
      chatService,
      closetRepository,
      userRepository
    })
  );

  app.use(
    "/api",
    createRecommendationRoutes({
      authService,
      recommendationRepository,
      userRepository,
      geminiRecommendationService,
      conversationRepository,
      closetRepository
    })
  );


  app.use(
    "/api",
    createClosetRoutes({
      authService,
      closetRepository,
      r2StorageService,
      reviewedImageStorageService,
      geminiExtractionService,
      geminiRecommendationService
    })
  );

  app.use(
    "/api",
    createShopRoutes({
      authService,
      closetRepository,
      geminiExtractionService,
      geminiRecommendationService,
      r2StorageService,
      reviewedImageStorageService,
      userRepository,
      imageGenerationService,
      generationRepository,
      recommendationRepository
    })
  );

  app.use(
    "/api",
    createGenerationRoutes({
      authService,
      userRepository,
      closetRepository,
      generationRepository,
      recommendationRepository,
      imageGenerationService,
      r2StorageService
    })
  );

  app.use("/api", createHealthRoutes());

  app.get("/", (_req, res) => {
    res.json({ status: "ok", message: "WearWise API" });
  });

  return app;
}
