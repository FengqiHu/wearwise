import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import { createChatRoutes } from "./chat-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { ChatService } from "../services/chat-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { ConversationRecord, StoredChatMessage, UserRecord } from "../types/domain.js";

export function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-1",
    email: "test@example.com",
    name: "Taylor",
    picture: null,
    profile: {
      name: "Taylor",
      heightCm: 180,
      weightKg: 75,
      sex: "other" as const,
      styleNote: "minimal streetwear",
      avatarUrl: null,
      fullBodyImageUrl: null,
      headshotImageUrl: null
    },
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

export function makeStoredMessage(overrides: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: "message-1",
    role: "user",
    content: "Recommend an outfit.",
    createdAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

export function makeConversationRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conversation-1",
    userId: "user-1",
    title: "Recommend an outfit.",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    lastMessageAt: "2026-03-24T00:00:00.000Z",
    messages: [makeStoredMessage()],
    ...overrides
  };
}

export async function startServer(dependencies: {
  authService: AuthService;
  chatService: ChatService;
  conversationRepository: ConversationRepository;
  recommendationRepository: RecommendationRepository;
  closetRepository: ClosetRepository;
  userRepository: UserRepository;
  geminiRecommendationService: GeminiRecommendationService;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createChatRoutes(dependencies));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server
  };
}

export async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
