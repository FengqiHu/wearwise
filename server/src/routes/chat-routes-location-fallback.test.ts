import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { ChatService } from "../services/chat-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";

type StreamChatInput = Parameters<ChatService["streamChat"]>[0];

import {
  makeUserRecord,
  makeStoredMessage,
  makeConversationRecord,
  startServer,
  stopServer
} from "./chat-routes-test-helpers.js";

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

  const geminiRecommendationService = {
    summarizeStyle: vi.fn().mockResolvedValue("")
  } as unknown as GeminiRecommendationService;

  return {
    dependencies: {
      authService,
      chatService,
      conversationRepository,
      recommendationRepository,
      closetRepository,
      userRepository,
      geminiRecommendationService
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

  it("includes a pre-recommendation checklist with ordered steps in the system message", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Pre-recommendation checklist");
    expect(systemMessage).toContain("Step 1");
    expect(systemMessage).toContain("Step 2");
    expect(systemMessage).toContain("Step 3");
    expect(systemMessage).toContain("Step 4");
  });

  it("instructs the model to ask for city when get_user_location fails and no location is provided", async () => {
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
    expect(systemMessage).toContain("What city are you in?");
    expect(systemMessage).toContain("at most once");
  });

  it("instructs the model to infer IANA timezone from city name when location is unavailable", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("infer its IANA timezone");
    expect(systemMessage).toContain("get_current_time");
  });

  it("instructs the model to ask about occasion after resolving time (DAYTIME and EVENING cases)", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("DAYTIME");
    expect(systemMessage).toContain("EVENING");
    expect(systemMessage).toContain("Do you have anything planned for tomorrow?");
  });

  it("skips location fallback instructions and uses provided timezone when location is available", async () => {
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
    expect(systemMessage).toContain("Location is available");
    expect(systemMessage).toContain("America/New_York");
    expect(systemMessage).not.toContain("What city are you in?");
  });
});
