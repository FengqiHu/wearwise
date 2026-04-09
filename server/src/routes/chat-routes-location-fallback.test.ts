import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import { createChatRoutes } from "./chat-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { ChatService } from "../services/chat-service.js";
import type { ClosetItemRecord, ConversationRecord, StoredChatMessage, UserRecord } from "../types/domain.js";

type StreamChatInput = Parameters<ChatService["streamChat"]>[0];

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-1",
    email: "test@example.com",
    name: "Taylor",
    picture: null,
    profile: {
      name: "Taylor",
      heightCm: 175,
      weightKg: 68,
      styleNote: "casual",
      avatarUrl: null,
      fullBodyImageUrl: null,
      headshotImageUrl: null
    },
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

function makeStoredMessage(overrides: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: "message-1",
    role: "user",
    content: "Recommend an outfit.",
    createdAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

function makeConversationRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
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

async function startServer(dependencies: {
  authService: AuthService;
  chatService: ChatService;
  conversationRepository: ConversationRepository;
  recommendationRepository: RecommendationRepository;
  closetRepository: ClosetRepository;
  userRepository: UserRepository;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createChatRoutes(dependencies));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function makeHarness() {
  const userRecord = makeUserRecord();
  let capturedStreamInput: StreamChatInput | null = null;

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({ user: userRecord, error: null })
  } as unknown as AuthService;

  const chatService = {
    isConfigured: vi.fn().mockReturnValue(true),
    streamChat: vi.fn(async (input: StreamChatInput) => {
      capturedStreamInput = input;
      input.onChunk('```json\n{"outfits":[]}\n```');
      return '```json\n{"outfits":[]}\n```';
    })
  } as unknown as ChatService;

  const conversationRepository = {
    createWithFirstUserMessage: vi.fn().mockResolvedValue(makeConversationRecord()),
    appendMessage: vi.fn().mockImplementation(
      async (_userId: string, conversationId: string, role: "user" | "assistant", content: string) =>
        makeConversationRecord({
          id: conversationId,
          messages: [makeStoredMessage(), makeStoredMessage({ id: "message-2", role, content })]
        })
    )
  } as unknown as ConversationRepository;

  const recommendationRepository = {
    createMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByMessage: vi.fn().mockResolvedValue([])
  } as unknown as RecommendationRepository;

  const closetRepository = {
    listByUser: vi.fn().mockResolvedValue([])
  } as unknown as ClosetRepository;

  const userRepository = {
    findById: vi.fn().mockResolvedValue(userRecord)
  } as unknown as UserRepository;

  return {
    dependencies: {
      authService,
      chatService,
      conversationRepository,
      recommendationRepository,
      closetRepository,
      userRepository
    },
    getCapturedStreamInput: () => capturedStreamInput
  };
}

describe("createChatRoutes POST /chat – location fallback instruction (#199)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("includes a location-unavailable fallback instruction in the system message", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("get_user_location");
    expect(systemMessage).toContain("ask the user");
  });

  it("instructs the model to ask at most once when location is unavailable", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("at most once");
  });

  it("includes the fallback instruction even when userLocation is provided", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Recommend an outfit.",
        userLocation: { lat: 40.7128, lon: -74.006, timezone: "America/New_York" }
      })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("get_user_location");
    expect(systemMessage).toContain("ask the user");
  });

  it("instructs the model to infer IANA timezone from city name when get_user_location fails", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("infer the IANA timezone");
    expect(systemMessage).toContain("get_current_time");
  });

  it("positions the location-unavailable instruction before the weather and occasion sections", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    const locationIdx = systemMessage.indexOf("Location unavailable");
    const weatherIdx = systemMessage.indexOf("Weather-aware recommendations");
    const occasionIdx = systemMessage.indexOf("Occasion awareness");

    expect(locationIdx).toBeGreaterThan(-1);
    expect(locationIdx).toBeLessThan(weatherIdx);
    expect(locationIdx).toBeLessThan(occasionIdx);
  });
});
