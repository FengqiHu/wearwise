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
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
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
      heightCm: 180,
      weightKg: 75,
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

function makeClosetItem(overrides: Partial<ClosetItemRecord> = {}): ClosetItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    imageUrl: "https://example.com/item.jpg",
    analysisStatus: "ready",
    analysisError: null,
    name: "Blue Oxford Shirt",
    category: "tops",
    tags: ["blue", "cotton"],
    description: "Lightweight blue oxford shirt",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

function makeStoredMessage(overrides: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: "message-1",
    role: "user",
    content: "Build me an outfit for class tomorrow.",
    createdAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

function makeConversationRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conversation-1",
    userId: "user-1",
    title: "Build me an outfit for class tomorrow.",
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

async function stopServer(server: Server): Promise<void> {
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

function makeRouteHarness(options: {
  closetItems?: ClosetItemRecord[];
  userRecord?: UserRecord;
  assistantReply?: string;
} = {}) {
  const userRecord = options.userRecord ?? makeUserRecord();
  const closetItems =
    options.closetItems ??
    [
      makeClosetItem({
        id: "ready-top",
        name: "Ready Shirt",
        category: "tops",
        tags: ["blue", "casual"],
        description: "Blue shirt",
        analysisStatus: "ready"
      }),
      makeClosetItem({
        id: "pending-bottom",
        name: "Pending Pants",
        category: "bottoms",
        tags: ["black"],
        description: "Pending analysis",
        analysisStatus: "pending"
      }),
      makeClosetItem({
        id: "error-coat",
        name: "Error Coat",
        category: "outerwear",
        tags: ["gray"],
        description: "Errored analysis",
        analysisStatus: "error",
        analysisError: "failed"
      }),
      makeClosetItem({
        id: "ready-shoe",
        name: "Ready Loafers",
        category: "shoes",
        tags: ["brown", "leather"],
        description: "Brown loafers",
        analysisStatus: "ready"
      })
    ];
  const assistantReply = options.assistantReply ?? '```json\n{"outfits":[]}\n```';
  let capturedStreamInput: StreamChatInput | null = null;

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      user: userRecord,
      error: null
    })
  } as unknown as AuthService;

  const chatService = {
    isConfigured: vi.fn().mockReturnValue(true),
    streamChat: vi.fn(async (input: StreamChatInput) => {
      capturedStreamInput = input;
      input.onChunk(assistantReply);
      return assistantReply;
    })
  } as unknown as ChatService;

  const conversationRepository = {
    createWithFirstUserMessage: vi.fn().mockResolvedValue(makeConversationRecord()),
    appendMessage: vi.fn().mockImplementation(async (_userId: string, conversationId: string, role: "user" | "assistant", content: string) =>
      makeConversationRecord({
        id: conversationId,
        messages: [
          makeStoredMessage(),
          makeStoredMessage({
            id: "message-2",
            role,
            content
          })
        ]
      })
    )
  } as unknown as ConversationRepository;

  const recommendationRepository = {
    createMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByMessage: vi.fn().mockResolvedValue([])
  } as unknown as RecommendationRepository;

  const closetRepository = {
    listByUser: vi.fn().mockResolvedValue(closetItems)
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
    getCapturedStreamInput: () => capturedStreamInput,
    spies: {
      authResolve: (authService as unknown as { resolveAuthenticatedUser: ReturnType<typeof vi.fn> }).resolveAuthenticatedUser,
      chatConfigured: (chatService as unknown as { isConfigured: ReturnType<typeof vi.fn> }).isConfigured,
      streamChat: (chatService as unknown as { streamChat: ReturnType<typeof vi.fn> }).streamChat,
      createConversation: (conversationRepository as unknown as { createWithFirstUserMessage: ReturnType<typeof vi.fn> }).createWithFirstUserMessage,
      appendMessage: (conversationRepository as unknown as { appendMessage: ReturnType<typeof vi.fn> }).appendMessage,
      listClosetItems: (closetRepository as unknown as { listByUser: ReturnType<typeof vi.fn> }).listByUser,
      findUser: (userRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById
    }
  };
}

describe("createChatRoutes POST /chat", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("builds the system message from ready wardrobe items and user profile only", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Build me an outfit for class tomorrow."
      })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-conversation-id")).toBe("conversation-1");
    expect(await response.text()).toBe('```json\n{"outfits":[]}\n```');

    expect(harness.spies.authResolve).toHaveBeenCalledOnce();
    expect(harness.spies.chatConfigured).toHaveBeenCalledOnce();
    expect(harness.spies.createConversation).toHaveBeenCalledWith("user-1", "Build me an outfit for class tomorrow.");
    expect(harness.spies.listClosetItems).toHaveBeenCalledWith("user-1");
    expect(harness.spies.findUser).toHaveBeenCalledWith("user-1");
    expect(harness.spies.streamChat).toHaveBeenCalledOnce();
    expect(harness.spies.appendMessage).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      "assistant",
      '```json\n{"outfits":[]}\n```'
    );

    const streamInput = harness.getCapturedStreamInput();
    const systemMessage = streamInput?.messages[0]?.content ?? "";

    expect(streamInput?.messages[0]).toEqual(
      expect.objectContaining({
        role: "system"
      })
    );
    expect(systemMessage).toContain("Wardrobe (2 items):");
    expect(systemMessage).toContain("ID: ready-top | Name: Ready Shirt");
    expect(systemMessage).toContain("ID: ready-shoe | Name: Ready Loafers");
    expect(systemMessage).not.toContain("Pending Pants");
    expect(systemMessage).not.toContain("Error Coat");
    expect(systemMessage).toContain("User profile:");
    expect(systemMessage).toContain("- Height: 180 cm");
    expect(systemMessage).toContain("- Weight: 75 kg");
    expect(systemMessage).toContain("- Style preferences: minimal streetwear");
  });

  it("includes the 3-outfit JSON schema instruction in the system message", async () => {
    const harness = makeRouteHarness({
      closetItems: [makeClosetItem({ id: "ready-only", name: "Ready Tee", category: "tops" })]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Recommend some outfits."
      })
    });

    expect(response.status).toBe(200);
    await response.text();

    expect(harness.spies.streamChat).toHaveBeenCalledOnce();

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";

    expect(systemMessage).toContain("For outfit recommendation requests: you MUST respond with ONLY a JSON code block");
    expect(systemMessage).toContain("```json");
    expect(systemMessage).toContain('"outfits": [');
    expect(systemMessage).toContain('"outfitName": "Outfit name here"');
    expect(systemMessage).toContain('"reason": "Why this outfit suits the occasion and user"');
    expect(systemMessage).toContain('{ "id": "<exact item ID>", "name": "<item name>" }');
    expect(systemMessage).toContain('Always include exactly 3 outfits in the "outfits" array');
    expect(systemMessage).toContain('Each outfit may contain at most one item per category');
    expect(systemMessage).toContain('Only use items from the wardrobe list above, with their exact IDs');
  });
});
