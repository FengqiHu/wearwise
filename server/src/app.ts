import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { ConversationRepository } from "./repositories/conversation-repository.js";
import { UserRepository } from "./repositories/user-repository.js";
import { createAuthRoutes } from "./routes/auth-routes.js";
import { createChatRoutes } from "./routes/chat-routes.js";
import { createHealthRoutes } from "./routes/health-routes.js";
import { createProfileRoutes } from "./routes/profile-routes.js";
import { AuthService } from "./services/auth-service.js";
import { ChatService } from "./services/chat-service.js";
import { GoogleOAuthService } from "./services/google-oauth-service.js";
import { SessionService } from "./services/session-service.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

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
  const sessionService = new SessionService(env.sessionSecret, env.sessionTtlSeconds);
  const authService = new AuthService(sessionService, userRepository);
  const chatService = new ChatService(env.openaiApiKey);
  const googleOAuthService = new GoogleOAuthService({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    defaultRedirectUri: env.googleRedirectUri
  });

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
      userRepository
    })
  );

  app.use(
    "/api",
    createChatRoutes({
      authService,
      conversationRepository,
      chatService
    })
  );

  app.use("/api", createHealthRoutes());

  return app;
}
