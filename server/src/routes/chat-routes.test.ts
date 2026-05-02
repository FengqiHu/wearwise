import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { filterAssistantText } from "./chat-routes.js";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { ChatService, SubmitOutfitArgs } from "../services/chat-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { ClosetItemRecord, RecommendationRecord, UserRecord } from "../types/domain.js";
import {
  makeUserRecord,
  makeStoredMessage,
  makeConversationRecord,
  startServer,
  stopServer
} from "./chat-routes-test-helpers.js";

type StreamChatInput = Parameters<ChatService["streamChat"]>[0];

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

async function postChat(baseUrl: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function makeRouteHarness(options: {
  closetItems?: ClosetItemRecord[];
  userRecord?: UserRecord;
  assistantReply?: string;
  outfitsToEmit?: SubmitOutfitArgs[];
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
    prefetchWeatherAndTime: vi.fn().mockResolvedValue({
      weatherSummary: null,
      currentTime: null,
      locationLabel: null
    }),
    streamChat: vi.fn(async (input: StreamChatInput) => {
      capturedStreamInput = input;
      input.onChunk(assistantReply);
      for (const outfit of options.outfitsToEmit ?? []) {
        await input.onOutfit?.(outfit);
      }
      return {
        assistantText: assistantReply,
        recommendationWeatherSummary: null
      };
    })
  } as unknown as ChatService;

  const conversationRepository = {
    createWithFirstUserMessage: vi.fn().mockImplementation(
      async (_userId: string, _content: string, accessoryMode: "include" | "exclude" | "auto" = "auto") =>
        makeConversationRecord({ accessoryMode })
    ),
    findById: vi.fn().mockResolvedValue(makeConversationRecord()),
    deleteById: vi.fn().mockResolvedValue(true),
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
    ),
    updateConversationFields: vi.fn().mockImplementation(async (_userId: string, conversationId: string, updates: { accessoryMode?: "include" | "exclude" | "auto" }) =>
      makeConversationRecord({ id: conversationId, accessoryMode: updates.accessoryMode ?? "auto" })
    ),
    findLatestAssistantRecommendationMessage: vi.fn().mockResolvedValue(null),
    setMessageRecommendationIds: vi.fn().mockResolvedValue(null)
  } as unknown as ConversationRepository;

  const recommendationRepository = {
    createMany: vi.fn().mockResolvedValue([]),
    deleteByConversation: vi.fn().mockResolvedValue(0),
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
      prefetchWeatherAndTime: (chatService as unknown as { prefetchWeatherAndTime: ReturnType<typeof vi.fn> }).prefetchWeatherAndTime,
      streamChat: (chatService as unknown as { streamChat: ReturnType<typeof vi.fn> }).streamChat,
      createConversation: (conversationRepository as unknown as { createWithFirstUserMessage: ReturnType<typeof vi.fn> }).createWithFirstUserMessage,
      findConversation: (conversationRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      deleteConversation: (conversationRepository as unknown as { deleteById: ReturnType<typeof vi.fn> }).deleteById,
      appendMessage: (conversationRepository as unknown as { appendMessage: ReturnType<typeof vi.fn> }).appendMessage,
      deleteRecommendationsByConversation: (recommendationRepository as unknown as { deleteByConversation: ReturnType<typeof vi.fn> }).deleteByConversation,
      createMany: (recommendationRepository as unknown as { createMany: ReturnType<typeof vi.fn> }).createMany,
      listClosetItems: (closetRepository as unknown as { listByUser: ReturnType<typeof vi.fn> }).listByUser,
      findUser: (userRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      summarizeStyle: (geminiRecommendationService as unknown as { summarizeStyle: ReturnType<typeof vi.fn> }).summarizeStyle,
      updateConversationFields: (conversationRepository as unknown as { updateConversationFields: ReturnType<typeof vi.fn> }).updateConversationFields,
      findLatestAssistantRecommendationMessage: (conversationRepository as unknown as { findLatestAssistantRecommendationMessage: ReturnType<typeof vi.fn> }).findLatestAssistantRecommendationMessage,
      findRecommendationById: (recommendationRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById
    }
  };
}





describe("createChatRoutes POST /chat – ISO timestamp prefixes on historical messages", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("prefixes each historical message with its ISO createdAt timestamp", async () => {
    const timestamp = "2026-03-31T09:00:00.000Z";
    const messageContent = "I need an outfit for my interview";

    const harness = makeRouteHarness({
      userRecord: makeUserRecord()
    });

    // Override conversation repo to return a conversation with a known message timestamp
    (harness.dependencies.conversationRepository as unknown as {
      createWithFirstUserMessage: ReturnType<typeof vi.fn>;
    }).createWithFirstUserMessage.mockResolvedValue(
      makeConversationRecord({
        messages: [
          makeStoredMessage({
            id: "message-1",
            role: "user",
            content: messageContent,
            createdAt: timestamp
          })
        ]
      })
    );

    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: messageContent })
    });

    const streamInput = harness.getCapturedStreamInput();
    // First message after system is the historical user message
    const firstUserMessage = streamInput?.messages[1];
    expect(firstUserMessage?.content).toBe(`[${timestamp}] ${messageContent}`);
  });

  it("prefixes multiple historical messages each with their own ISO timestamp", async () => {
    const userTimestamp = "2026-03-31T09:00:00.000Z";
    const assistantTimestamp = "2026-03-31T09:01:00.000Z";

    const harness = makeRouteHarness();

    (harness.dependencies.conversationRepository as unknown as {
      createWithFirstUserMessage: ReturnType<typeof vi.fn>;
    }).createWithFirstUserMessage.mockResolvedValue(
      makeConversationRecord({
        messages: [
          makeStoredMessage({
            id: "msg-1",
            role: "user",
            content: "What outfit for a casual lunch?",
            createdAt: userTimestamp
          }),
          makeStoredMessage({
            id: "msg-2",
            role: "assistant",
            content: "Here are some options...",
            createdAt: assistantTimestamp
          })
        ]
      })
    );

    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What outfit for a casual lunch?" })
    });

    const streamInput = harness.getCapturedStreamInput();
    expect(streamInput?.messages[1]?.content).toBe(`[${userTimestamp}] What outfit for a casual lunch?`);
    expect(streamInput?.messages[2]?.content).toBe(`[${assistantTimestamp}] Here are some options...`);
  });
});


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

    const response = await postChat(started.baseUrl, {
      message: "Build me an outfit for class tomorrow."
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-conversation-id")).toBe("conversation-1");
    // Text is sent via fake streaming as small SSE chunks — check headers and DB save instead
    const body = await response.text();
    expect(body).toContain("data:");

    expect(harness.spies.authResolve).toHaveBeenCalledOnce();
    expect(harness.spies.chatConfigured).toHaveBeenCalledOnce();
    expect(harness.spies.createConversation).toHaveBeenCalledWith("user-1", "Build me an outfit for class tomorrow.", "auto");
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

  it("includes the submit_outfit instruction in the system message", async () => {
    const harness = makeRouteHarness({
      closetItems: [makeClosetItem({ id: "ready-only", name: "Ready Tee", category: "tops" })]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, {
      message: "Recommend some outfits."
    });

    expect(response.status).toBe(200);
    await response.text();

    expect(harness.spies.streamChat).toHaveBeenCalledOnce();

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";

    expect(systemMessage).toContain("submit_outfit tool once per outfit");
    expect(systemMessage).toContain("Do NOT output a JSON code block for outfits");
    expect(systemMessage).toContain("Infer the number of outfits from the user's request");
    expect(systemMessage).toContain("Each outfit may contain at most one item per category");
    expect(systemMessage).toContain("Only use items from the wardrobe list above, with their exact IDs");
  });

});

describe("createChatRoutes POST /chat – submit_outfit tool behavior", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("calls createMany with outfit data when onOutfit is triggered", async () => {
    const outfit: SubmitOutfitArgs = {
      outfitName: "Casual Friday",
      reason: "Relaxed yet put-together for a casual office day",
      items: [{ id: "ready-top", name: "Ready Shirt" }],
      occasions: ["casual"],
      weatherSummary: "20°C, sunny"
    };
    const harness = makeRouteHarness({ outfitsToEmit: [outfit] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Suggest an outfit." });

    expect(harness.spies.createMany).toHaveBeenCalledOnce();
    expect(harness.spies.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          outfitName: "Casual Friday",
          reason: "Relaxed yet put-together for a casual office day",
          items: [{ id: "ready-top", name: "Ready Shirt" }],
          occasions: ["casual"],
          weather: "20°C, sunny"
        })
      ])
    );
  });

  it("writes SSE event: outfit lines for each submitted outfit", async () => {
    const outfit: SubmitOutfitArgs = {
      outfitName: "Weekend Look",
      reason: "Laid-back weekend style",
      items: [{ id: "ready-top", name: "Ready Shirt" }],
      occasions: [],
    };
    const harness = makeRouteHarness({ outfitsToEmit: [outfit] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "Suggest an outfit." });
    const body = await response.text();

    expect(body).toContain("event: outfit\ndata: ");
    const outfitDataLine = body.split("\n").find((l) => l.startsWith("data: ") && l.includes("Weekend Look"));
    expect(outfitDataLine).toBeDefined();
    const parsed = JSON.parse(outfitDataLine!.slice("data: ".length)) as Record<string, unknown>;
    expect(parsed.outfitName).toBe("Weekend Look");
  });

  it("calls createMany with empty occasions when outfit has no occasions", async () => {
    const outfit: SubmitOutfitArgs = {
      outfitName: "No-Occasion Fit",
      reason: "Works any day",
      items: [{ id: "ready-top", name: "Ready Shirt" }],
    };
    const harness = makeRouteHarness({ outfitsToEmit: [outfit] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Suggest an outfit." });

    expect(harness.spies.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ occasions: [] })])
    );
  });
});

describe("createChatRoutes POST /chat – wardrobeItems passed to streamChat (#325)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("passes wardrobeItems derived from closet items to streamChat", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "item-1", name: "Black Polo", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "item-2", name: "Slim Jeans", category: "pants", analysisStatus: "ready" })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Suggest an outfit." });

    const wardrobeItems = harness.getCapturedStreamInput()?.wardrobeItems;
    expect(wardrobeItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "item-1", name: "Black Polo", category: "tops" }),
        expect.objectContaining({ id: "item-2", name: "Slim Jeans", category: "pants" })
      ])
    );
  });

  it("passes empty wardrobeItems when the user has no closet items", async () => {
    const harness = makeRouteHarness({ closetItems: [] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Suggest an outfit." });

    expect(harness.getCapturedStreamInput()?.wardrobeItems).toEqual([]);
  });
});

describe("createChatRoutes POST /chat – variable outfit count end-to-end (#267, #270)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it.each([1, 3, 5])(
    "emits %i SSE outfit events and persists %i recommendations when the LLM streams %i outfits",
    async (count) => {
      const outfits: SubmitOutfitArgs[] = Array.from({ length: count }, (_, i) => ({
        outfitName: `Outfit ${i + 1}`,
        reason: `Reason for outfit ${i + 1}`,
        items: [{ id: "ready-top", name: "Ready Shirt" }],
        occasions: []
      }));
      const harness = makeRouteHarness({ outfitsToEmit: outfits });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await postChat(started.baseUrl, { message: `Suggest ${count} outfits.` });
      const body = await response.text();

      // SSE stream contains exactly one outfit data line per streamed outfit
      const outfitDataLines = body
        .split("\n")
        .filter((line) => line.startsWith("data: ") && /"outfitName":"Outfit \d+"/.test(line));
      expect(outfitDataLines).toHaveLength(count);

      // Persistence: createMany receives an array of exactly `count` recommendations
      expect(harness.spies.createMany).toHaveBeenCalledOnce();
      const createManyArg = harness.spies.createMany.mock.calls[0]?.[0] as unknown[];
      expect(createManyArg).toHaveLength(count);
    }
  );
});

describe("createChatRoutes POST /chat – prefetchWeatherAndTime call behavior", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("calls prefetchWeatherAndTime with browserLocation when userLocation is provided", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, {
      message: "Suggest an outfit.",
      userLocation: { lat: 40.7128, lon: -74.006, timezone: "America/New_York" }
    });

    expect(harness.spies.prefetchWeatherAndTime).toHaveBeenCalledOnce();
    expect(harness.spies.prefetchWeatherAndTime).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 40.7128, lon: -74.006 })
    );
  });

  it("skips prefetchWeatherAndTime when no userLocation is provided", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Suggest an outfit." });

    expect(harness.spies.prefetchWeatherAndTime).not.toHaveBeenCalled();
  });
});

describe("createChatRoutes DELETE /chat/conversations/:conversationId", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("returns 404 and does not delete recommendations when the conversation does not exist", async () => {
    const harness = makeRouteHarness();
    harness.spies.findConversation.mockResolvedValue(null);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/chat/conversations/missing-conversation`, {
      method: "DELETE"
    });

    expect(response.status).toBe(404);
    expect(harness.spies.deleteConversation).not.toHaveBeenCalled();
    expect(harness.spies.deleteRecommendationsByConversation).not.toHaveBeenCalled();
  });

  it("deletes the conversation and cascades recommendation deletion for that user and conversation", async () => {
    const harness = makeRouteHarness();
    harness.spies.findConversation.mockResolvedValue(makeConversationRecord({ id: "conversation-1" }));
    harness.spies.deleteConversation.mockResolvedValue(true);
    harness.spies.deleteRecommendationsByConversation.mockResolvedValue(2);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/chat/conversations/conversation-1`, {
      method: "DELETE"
    });

    expect(response.status).toBe(204);
    expect(harness.spies.findConversation).toHaveBeenCalledWith("user-1", "conversation-1");
    expect(harness.spies.deleteConversation).toHaveBeenCalledWith("user-1", "conversation-1");
    expect(harness.spies.deleteRecommendationsByConversation).toHaveBeenCalledWith("user-1", "conversation-1");
  });
});

// ---------------------------------------------------------------------------
// GET /chat/conversations/:conversationId – recommendation hydration (#158)
// ---------------------------------------------------------------------------

describe("createChatRoutes GET /chat/conversations/:conversationId – recommendation hydration", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  function makeGetHarness(options: {
    conversation?: ReturnType<typeof makeConversationRecord> | null;
    recommendations?: (RecommendationRecord | null)[];
  } = {}) {
    const conversation = options.conversation !== undefined
      ? options.conversation
      : makeConversationRecord();
    const recommendations = options.recommendations ?? [];

    const authService = {
      resolveAuthenticatedUser: vi.fn().mockResolvedValue({ user: makeUserRecord(), error: null })
    } as unknown as AuthService;

    const conversationRepository = {
      findById: vi.fn().mockResolvedValue(conversation)
    } as unknown as ConversationRepository;

    let callIndex = 0;
    const recommendationRepository = {
      findById: vi.fn().mockImplementation(() => {
        const rec = recommendations[callIndex] ?? null;
        callIndex++;
        return Promise.resolve(rec);
      })
    } as unknown as RecommendationRepository;

    const chatService = {
      isConfigured: vi.fn().mockReturnValue(true),
      streamChat: vi.fn()
    } as unknown as ChatService;

    const closetRepository = {
      listByUser: vi.fn().mockResolvedValue([])
    } as unknown as ClosetRepository;

    const userRepository = {
      findById: vi.fn().mockResolvedValue(makeUserRecord())
    } as unknown as UserRepository;

    const geminiRecommendationService = {
      summarizeStyle: vi.fn().mockResolvedValue("")
    } as unknown as GeminiRecommendationService;

    return {
      dependencies: { authService, chatService, conversationRepository, recommendationRepository, closetRepository, userRepository, geminiRecommendationService },
      spies: {
        authResolve: authService.resolveAuthenticatedUser as ReturnType<typeof vi.fn>,
        findConversation: conversationRepository.findById as ReturnType<typeof vi.fn>,
        findRecommendation: recommendationRepository.findById as ReturnType<typeof vi.fn>
      }
    };
  }

  it("returns 401 when unauthenticated", async () => {
    const harness = makeGetHarness();
    harness.spies.authResolve.mockResolvedValue({ user: null, error: { status: 401, message: "Unauthorized." } });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/conv-1`);

    expect(res.status).toBe(401);
  });

  it("returns 404 when the conversation does not exist", async () => {
    const harness = makeGetHarness({ conversation: null });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/missing`);

    expect(res.status).toBe(404);
  });

  it("returns messages without recommendations when no recommendationIds are set", async () => {
    const message = makeStoredMessage({ id: "msg-1", role: "assistant", content: "Hello" });
    const conversation = makeConversationRecord({ messages: [message] });
    const harness = makeGetHarness({ conversation });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/conv-1`);

    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ id: string; recommendations?: unknown }> };
    expect(harness.spies.findRecommendation).not.toHaveBeenCalled();
    expect(body.messages[0]?.recommendations).toBeUndefined();
  });

  it("hydrates recommendations onto a message that has recommendationIds", async () => {
    const rec: RecommendationRecord = {
      id: "rec-1",
      userId: "user-1",
      outfitName: "Smart Casual",
      reason: "Great for work",
      items: [{ id: "item-1", name: "Oxford Shirt" }],
      occasions: ["work"],
      generation: null,
      vote: null,
      conversationId: "conv-1",
      messageId: "msg-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const message = makeStoredMessage({ id: "msg-2", role: "assistant", recommendationIds: ["rec-1"] });
    const conversation = makeConversationRecord({ messages: [message] });
    const harness = makeGetHarness({ conversation, recommendations: [rec] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/conv-1`);

    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ id: string; recommendations: RecommendationRecord[] }> };
    const hydratedMessage = body.messages[0];
    expect(hydratedMessage?.recommendations).toHaveLength(1);
    expect(hydratedMessage?.recommendations[0]?.id).toBe("rec-1");
    expect(hydratedMessage?.recommendations[0]?.outfitName).toBe("Smart Casual");
  });

  it("filters out null recommendation lookups from hydrated message", async () => {
    const message = makeStoredMessage({ id: "msg-2", role: "assistant", recommendationIds: ["rec-exists", "rec-deleted"] });
    const conversation = makeConversationRecord({ messages: [message] });
    const existingRec: RecommendationRecord = {
      id: "rec-exists",
      userId: "user-1",
      outfitName: "Outfit A",
      reason: "Nice",
      items: [],
      occasions: [],
      generation: null,
      vote: null,
      conversationId: "conv-1",
      messageId: "msg-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const harness = makeGetHarness({ conversation, recommendations: [existingRec, null] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/conv-1`);

    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ recommendations: RecommendationRecord[] }> };
    expect(body.messages[0]?.recommendations).toHaveLength(1);
    expect(body.messages[0]?.recommendations[0]?.id).toBe("rec-exists");
  });

  it("returns the conversation accessoryMode in the response (default auto)", async () => {
    const harness = makeGetHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/conv-1`);

    expect(res.status).toBe(200);
    const body = await res.json() as { conversation: { accessoryMode: string } };
    expect(body.conversation.accessoryMode).toBe("auto");
  });

  it("returns the persisted accessoryMode when the conversation has a non-default mode", async () => {
    const conversation = makeConversationRecord({ accessoryMode: "exclude" });
    const harness = makeGetHarness({ conversation });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/chat/conversations/conv-1`);

    expect(res.status).toBe(200);
    const body = await res.json() as { conversation: { accessoryMode: string } };
    expect(body.conversation.accessoryMode).toBe("exclude");
  });
});

describe("createChatRoutes POST /chat – accessory mode tool wiring", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("seeds accessoryMode on new conversations from the request body", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, {
      message: "Build me an outfit with no accessories.",
      accessoryMode: "exclude"
    });

    expect(response.status).toBe(200);
    await response.text();

    expect(harness.spies.createConversation).toHaveBeenCalledWith(
      "user-1",
      "Build me an outfit with no accessories.",
      "exclude"
    );
  });

  it("defaults new-conversation accessoryMode to 'auto' when the body omits it", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });

    expect(harness.spies.createConversation).toHaveBeenCalledWith("user-1", "Hello", "auto");
  });

  it("ignores body accessoryMode on existing conversations and uses the persisted value", async () => {
    const harness = makeRouteHarness();
    harness.spies.appendMessage.mockResolvedValue(
      makeConversationRecord({ id: "conv-existing", accessoryMode: "include" })
    );
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, {
      message: "What should I wear?",
      conversationId: "conv-existing",
      accessoryMode: "exclude"
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Current accessoryMode for this conversation: include");
    expect(systemMessage).toContain("Every outfit MUST include at least one accessory item");
  });

  it("injects an accessoryModeContext whose onModeChanged sets addAccessoriesOffer pending when switching to exclude", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Recommend an outfit." });

    const capturedInput = harness.getCapturedStreamInput();
    expect(capturedInput?.accessoryModeContext).toBeDefined();

    await capturedInput?.accessoryModeContext?.onModeChanged("exclude");

    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      {
        accessoryMode: "exclude",
        pendingConfirmation: {
          type: "addAccessoriesOffer",
          createdAt: expect.any(String)
        }
      }
    );
  });

  it("clears pendingConfirmation when onModeChanged is called with auto or include", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Recommend an outfit." });
    const capturedInput = harness.getCapturedStreamInput();

    await capturedInput?.accessoryModeContext?.onModeChanged("auto");
    expect(harness.spies.updateConversationFields).toHaveBeenLastCalledWith(
      "user-1",
      expect.any(String),
      { accessoryMode: "auto", pendingConfirmation: null }
    );

    await capturedInput?.accessoryModeContext?.onModeChanged("include");
    expect(harness.spies.updateConversationFields).toHaveBeenLastCalledWith(
      "user-1",
      expect.any(String),
      { accessoryMode: "include", pendingConfirmation: null }
    );
  });

  it("computes wardrobeHasAccessories=true when the wardrobe has a ready accessory", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-acc", category: "accessories", analysisStatus: "ready" })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });

    const capturedInput = harness.getCapturedStreamInput();
    expect(capturedInput?.accessoryModeContext?.wardrobeHasAccessories).toBe(true);
  });

  it("computes wardrobeHasAccessories=false when no ready accessory exists", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "pending-acc", category: "accessories", analysisStatus: "pending" })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });

    const capturedInput = harness.getCapturedStreamInput();
    expect(capturedInput?.accessoryModeContext?.wardrobeHasAccessories).toBe(false);
  });

  it("returns no_recent_recommendation from onAddBackRequested when there is no prior assistant recommendation", async () => {
    const harness = makeRouteHarness({
      closetItems: [makeClosetItem({ id: "ready-acc", category: "accessories", analysisStatus: "ready" })]
    });
    harness.spies.findLatestAssistantRecommendationMessage.mockResolvedValue(null);
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });
    const capturedInput = harness.getCapturedStreamInput();
    const result = await capturedInput?.accessoryModeContext?.onAddBackRequested({});

    expect(result).toEqual({ ok: false, error: "no_recent_recommendation" });
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalled();
  });

  it("returns no_accessories_in_wardrobe from onAddBackRequested when there are no ready accessories", async () => {
    const harness = makeRouteHarness({
      closetItems: [makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" })]
    });
    harness.spies.findLatestAssistantRecommendationMessage.mockResolvedValue({
      messageId: "assistant-msg-1",
      recommendationIds: ["rec-1"]
    });
    harness.spies.findRecommendationById.mockResolvedValue({
      id: "rec-1",
      userId: "user-1",
      outfitName: "Casual Look",
      reason: "Because",
      items: [{ id: "ready-top", name: "Ready Shirt" }],
      occasions: [],
      weather: null,
      generation: null,
      vote: null,
      conversationId: "conversation-1",
      messageId: "assistant-msg-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });
    const capturedInput = harness.getCapturedStreamInput();
    const result = await capturedInput?.accessoryModeContext?.onAddBackRequested({});

    expect(result).toEqual({ ok: false, error: "no_accessories_in_wardrobe" });
  });

  it("returns accessories + transitions pending to futureAccessoryMode on successful onAddBackRequested", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({
          id: "ready-watch",
          name: "Silver Watch",
          category: "accessories",
          tags: ["silver"],
          analysisStatus: "ready"
        })
      ]
    });
    harness.spies.findLatestAssistantRecommendationMessage.mockResolvedValue({
      messageId: "assistant-msg-1",
      recommendationIds: ["rec-1"]
    });
    harness.spies.findRecommendationById.mockResolvedValue({
      id: "rec-1",
      userId: "user-1",
      outfitName: "Casual Look",
      reason: "Because",
      items: [{ id: "ready-top", name: "Ready Shirt" }],
      occasions: [],
      weather: null,
      generation: null,
      vote: null,
      conversationId: "conversation-1",
      messageId: "assistant-msg-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });
    const capturedInput = harness.getCapturedStreamInput();
    const result = await capturedInput?.accessoryModeContext?.onAddBackRequested({ outfitIndex: 0 });

    expect(result).toEqual({
      ok: true,
      originalOutfits: [
        { outfitName: "Casual Look", items: [{ id: "ready-top", name: "Ready Shirt" }] }
      ],
      availableAccessories: [
        { id: "ready-watch", name: "Silver Watch", category: "accessories", tags: ["silver"] }
      ],
      targetOutfitIndex: 0
    });
    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      {
        pendingConfirmation: {
          type: "futureAccessoryMode",
          createdAt: expect.any(String)
        }
      }
    );
  });

});

describe("createChatRoutes POST /chat/conversations/:conversationId/mode", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  async function postMode(baseUrl: string, conversationId: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/chat/conversations/${conversationId}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("returns 401 when unauthenticated", async () => {
    const harness = makeRouteHarness();
    harness.spies.authResolve.mockResolvedValue({ user: null, error: { status: 401, message: "Unauthorized." } });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postMode(started.baseUrl, "conv-1", { mode: "exclude" });

    expect(res.status).toBe(401);
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation does not exist", async () => {
    const harness = makeRouteHarness();
    harness.spies.findConversation.mockResolvedValue(null);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postMode(started.baseUrl, "missing", { mode: "exclude" });

    expect(res.status).toBe(404);
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalled();
  });

  it("returns 400 when mode is missing or invalid", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const missing = await postMode(started.baseUrl, "conv-1", {});
    expect(missing.status).toBe(400);

    const invalid = await postMode(started.baseUrl, "conv-1", { mode: "maybe" });
    expect(invalid.status).toBe(400);

    expect(harness.spies.updateConversationFields).not.toHaveBeenCalled();
  });

  it("persists mode=auto and clears any pendingConfirmation", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postMode(started.baseUrl, "conv-1", { mode: "auto" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessoryMode: "auto" });
    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      "conv-1",
      { accessoryMode: "auto", pendingConfirmation: null }
    );
  });

  it("persists mode=exclude and writes an addAccessoriesOffer pending", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postMode(started.baseUrl, "conv-1", { mode: "exclude" });

    expect(res.status).toBe(200);
    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      "conv-1",
      {
        accessoryMode: "exclude",
        pendingConfirmation: { type: "addAccessoriesOffer", createdAt: expect.any(String) }
      }
    );
  });

  it("persists mode=include and clears pending when the wardrobe has a ready accessory", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-acc", category: "accessories", analysisStatus: "ready" })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postMode(started.baseUrl, "conv-1", { mode: "include" });

    expect(res.status).toBe(200);
    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      "conv-1",
      { accessoryMode: "include", pendingConfirmation: null }
    );
  });

  it("returns 409 no_accessories_in_wardrobe and does not persist when include is requested with no ready accessory", async () => {
    const harness = makeRouteHarness({
      closetItems: [makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" })]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postMode(started.baseUrl, "conv-1", { mode: "include" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_accessories_in_wardrobe" });
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalled();
  });
});

describe("createChatRoutes POST /chat – conversational mode switching end-to-end (#258)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("reflects futureAccessoryMode pending in the system prompt", async () => {
    const harness = makeRouteHarness();
    harness.spies.createConversation.mockResolvedValue(
      makeConversationRecord({
        pendingConfirmation: { type: "futureAccessoryMode", createdAt: "2026-04-01T00:00:00.000Z" }
      })
    );
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "a" });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Pending confirmation state for this conversation: futureAccessoryMode");
    expect(systemMessage).toContain("set_accessory_mode");
  });

  it("persists exclude mode and sets addAccessoriesOffer pending when LLM calls set_accessory_mode with exclude during streaming", async () => {
    const harness = makeRouteHarness();
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      await input.accessoryModeContext!.onModeChanged("exclude");
      input.onChunk("Got it — accessories excluded.");
      return { assistantText: "Got it — accessories excluded.", recommendationWeatherSummary: null };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "No accessories please." });
    await response.text();

    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      {
        accessoryMode: "exclude",
        pendingConfirmation: { type: "addAccessoriesOffer", createdAt: expect.any(String) }
      }
    );
  });

  it("persists include mode and clears pending when LLM calls set_accessory_mode with include", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-acc", name: "Silver Watch", category: "accessories", analysisStatus: "ready" })
      ]
    });
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      await input.accessoryModeContext!.onModeChanged("include");
      input.onChunk("Done — accessories included.");
      return { assistantText: "Done — accessories included.", recommendationWeatherSummary: null };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "Include accessories please." });
    await response.text();

    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      { accessoryMode: "include", pendingConfirmation: null }
    );
  });

  it("clears futureAccessoryMode pending and persists mode when LLM calls set_accessory_mode on conversation with that pending state", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-acc", name: "Silver Watch", category: "accessories", analysisStatus: "ready" })
      ]
    });
    harness.spies.appendMessage.mockResolvedValue(
      makeConversationRecord({
        id: "conv-existing",
        accessoryMode: "exclude",
        pendingConfirmation: { type: "futureAccessoryMode", createdAt: "2026-04-01T00:00:00.000Z" }
      })
    );
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      await input.accessoryModeContext!.onModeChanged("include");
      input.onChunk("Future mode set to include.");
      return { assistantText: "Future mode set to include.", recommendationWeatherSummary: null };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "b", conversationId: "conv-existing" });
    await response.text();

    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      "conv-existing",
      { accessoryMode: "include", pendingConfirmation: null }
    );
  });

  it("transitions pending to futureAccessoryMode when LLM calls add_accessories_to_recommendation", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-watch", name: "Silver Watch", category: "accessories", tags: ["silver"], analysisStatus: "ready" })
      ]
    });
    harness.spies.findLatestAssistantRecommendationMessage.mockResolvedValue({
      messageId: "assistant-msg-1",
      recommendationIds: ["rec-1"]
    });
    harness.spies.findRecommendationById.mockResolvedValue({
      id: "rec-1", userId: "user-1", outfitName: "Casual Look", reason: "Nice",
      items: [{ id: "ready-top", name: "Ready Shirt" }], occasions: [], weather: null,
      generation: null, vote: null, conversationId: "conversation-1",
      messageId: "assistant-msg-1", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z"
    });
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      await input.accessoryModeContext!.onAddBackRequested({});
      input.onChunk("Here are your outfits with accessories.");
      return { assistantText: "Here are your outfits with accessories.", recommendationWeatherSummary: null };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "yes, add accessories" });
    await response.text();

    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      { pendingConfirmation: { type: "futureAccessoryMode", createdAt: expect.any(String) } }
    );
  });

  it("passes targetOutfitIndex when LLM calls add_accessories_to_recommendation for a specific outfit", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-watch", name: "Silver Watch", category: "accessories", tags: ["silver"], analysisStatus: "ready" })
      ]
    });
    harness.spies.findLatestAssistantRecommendationMessage.mockResolvedValue({
      messageId: "assistant-msg-1",
      recommendationIds: ["rec-1", "rec-2"]
    });
    harness.spies.findRecommendationById
      .mockResolvedValueOnce({
        id: "rec-1", userId: "user-1", outfitName: "Casual Look", reason: "Nice",
        items: [{ id: "ready-top", name: "Ready Shirt" }], occasions: [], weather: null,
        generation: null, vote: null, conversationId: "conversation-1",
        messageId: "assistant-msg-1", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z"
      })
      .mockResolvedValueOnce({
        id: "rec-2", userId: "user-1", outfitName: "Smart Look", reason: "Sharp",
        items: [{ id: "ready-top", name: "Ready Shirt" }], occasions: [], weather: null,
        generation: null, vote: null, conversationId: "conversation-1",
        messageId: "assistant-msg-1", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z"
      });
    let capturedAddBackResult: unknown;
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      capturedAddBackResult = await input.accessoryModeContext!.onAddBackRequested({ outfitIndex: 1 });
      input.onChunk("Here is your second outfit with accessories.");
      return { assistantText: "Here is your second outfit with accessories.", recommendationWeatherSummary: null };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "the second one" });
    await response.text();

    expect(capturedAddBackResult).toMatchObject({ ok: true, targetOutfitIndex: 1 });
    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      { pendingConfirmation: { type: "futureAccessoryMode", createdAt: expect.any(String) } }
    );
  });

  it("does not update accessoryMode or pendingConfirmation when LLM replies with text only and calls no accessory tool", async () => {
    const harness = makeRouteHarness();
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      input.onChunk("Just to confirm — would you like to (a) include accessories, (b) exclude, or (c) let me decide?");
      return {
        assistantText: "Just to confirm — would you like to (a) include accessories, (b) exclude, or (c) let me decide?",
        recommendationWeatherSummary: null
      };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "keep it minimal" });
    await response.text();

    expect(harness.spies.updateConversationFields).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ accessoryMode: expect.anything() })
    );
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ pendingConfirmation: expect.anything() })
    );
  });

  it("persists exclude mode when user confirms after accessoryMode pending round-trip", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "ready-acc", name: "Silver Watch", category: "accessories", analysisStatus: "ready" })
      ]
    });
    // Simulate a conversation where the AI previously asked "Got it — exclude accessories, correct?"
    // and set accessoryMode pending; user now confirms with "b"
    harness.spies.appendMessage.mockResolvedValue(
      makeConversationRecord({
        id: "conv-awaiting-confirm",
        pendingConfirmation: { type: "accessoryMode", requestedMode: "exclude", createdAt: "2026-04-01T00:00:00.000Z" }
      })
    );
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      await input.accessoryModeContext!.onModeChanged("exclude");
      input.onChunk("Confirmed — accessories excluded.");
      return { assistantText: "Confirmed — accessories excluded.", recommendationWeatherSummary: null };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "b", conversationId: "conv-awaiting-confirm" });
    await response.text();

    expect(harness.spies.updateConversationFields).toHaveBeenCalledWith(
      "user-1",
      "conv-awaiting-confirm",
      {
        accessoryMode: "exclude",
        pendingConfirmation: { type: "addAccessoriesOffer", createdAt: expect.any(String) }
      }
    );
  });

  it("reflects addAccessoriesOffer pending in the system prompt and preserves it when LLM answers off-topic without calling a tool", async () => {
    const harness = makeRouteHarness();
    harness.spies.appendMessage.mockResolvedValue(
      makeConversationRecord({
        id: "conv-offer-pending",
        accessoryMode: "exclude",
        pendingConfirmation: { type: "addAccessoriesOffer", createdAt: "2026-04-01T00:00:00.000Z" }
      })
    );
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, {
      message: "What is the capital of France?",
      conversationId: "conv-offer-pending"
    });
    await response.text();

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Pending confirmation state for this conversation: addAccessoriesOffer");
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ pendingConfirmation: expect.anything() })
    );
  });

  it("passes wardrobeHasAccessories=false to streamChat and does not persist accessoryMode when wardrobe has no ready accessories", async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", category: "tops", analysisStatus: "ready" }),
        makeClosetItem({ id: "pending-acc", category: "accessories", analysisStatus: "pending" })
      ]
    });
    let capturedHasAccessories: boolean | undefined;
    harness.spies.streamChat.mockImplementation(async (input: StreamChatInput) => {
      capturedHasAccessories = input.accessoryModeContext?.wardrobeHasAccessories;
      input.onChunk("You have no accessories in your wardrobe. Please upload some first.");
      return {
        assistantText: "You have no accessories in your wardrobe. Please upload some first.",
        recommendationWeatherSummary: null
      };
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, { message: "include accessories please" });
    await response.text();

    expect(capturedHasAccessories).toBe(false);
    expect(harness.spies.updateConversationFields).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ accessoryMode: expect.anything() })
    );
  });
});

describe("filterAssistantText (#327)", () => {
  it("strips a leading ISO timestamp from the response", () => {
    expect(filterAssistantText("[2026-04-17T10:00:00.000Z] Hello there!")).toBe("Hello there!");
  });

  it("strips a leading timestamp with timezone offset", () => {
    expect(filterAssistantText("[2026-04-17T10:00:00Z] Nice to meet you.")).toBe("Nice to meet you.");
  });

  it("passes through normal text with no timestamp", () => {
    expect(filterAssistantText("Here are your outfit suggestions.")).toBe("Here are your outfit suggestions.");
  });

  it("does not strip a timestamp that appears mid-response", () => {
    const text = "Hello! On [2026-04-17T10:00:00Z] you mentioned a job interview.";
    expect(filterAssistantText(text)).toBe(text);
  });

  it("strips leading whitespace left after timestamp removal", () => {
    expect(filterAssistantText("[2026-04-17T10:00:00Z]   Hello.")).toBe("Hello.");
  });

  it("passes through an empty string unchanged", () => {
    expect(filterAssistantText("")).toBe("");
  });
});

describe("filterAssistantText – add-accessories tail trim (#360)", () => {
  const ANCHOR =
    "For future recommendations, would you like me to (a) let you decide, or (b) always include accessories?";

  it("trims a chain-of-thought block that follows the anchor", () => {
    const reply =
      "Done — I added a necklace to the second outfit and saved it. " +
      ANCHOR +
      "\nI'll call the process.\n\nWe need to answer the user's last message...";
    expect(filterAssistantText(reply)).toBe(
      "Done — I added a necklace to the second outfit and saved it. " + ANCHOR
    );
  });

  it("trims a fabricated tool-failure narration that follows the anchor", () => {
    const reply =
      "Nice — I added the accessory to the second outfit. " +
      ANCHOR +
      "I couldn't retrieve your location — it looks like the browser denied permission.";
    expect(filterAssistantText(reply)).toBe(
      "Nice — I added the accessory to the second outfit. " + ANCHOR
    );
  });

  it("leaves the reply unchanged when the anchor is present but nothing follows it", () => {
    const reply = "Done — added accessories to the second outfit. " + ANCHOR;
    expect(filterAssistantText(reply)).toBe(reply);
  });

  it("leaves the reply unchanged when the anchor is absent", () => {
    const reply =
      "Got it — I'll exclude accessories from future outfit recommendations. How can I help with getting dressed today?";
    expect(filterAssistantText(reply)).toBe(reply);
  });

  it("strips a leading timestamp and trims a trailing leak in the same response", () => {
    const reply =
      "[2026-05-02T03:23:41Z] Done — I added a necklace to the second outfit. " +
      ANCHOR +
      "\nI'll call the process.";
    expect(filterAssistantText(reply)).toBe(
      "Done — I added a necklace to the second outfit. " + ANCHOR
    );
  });

  it("trims a trailing leak when the future-recommendations clause is at the end of the question", () => {
    const variantQuestion =
      "Would you like me to (a) let you decide, or (b) always include accessories for future recommendations?";
    const reply =
      "Nice — I added accessories to the second outfit. " +
      variantQuestion +
      "I couldn't access your location from the browser.";
    expect(filterAssistantText(reply)).toBe(
      "Nice — I added accessories to the second outfit. " + variantQuestion
    );
  });

  it("matches the question regardless of leading capitalization", () => {
    const lowercaseQuestion =
      "would you like me to (a) let you decide, or (b) always include accessories?";
    const reply =
      "Done — accessories added. " +
      lowercaseQuestion +
      " We need to answer the user's last message...";
    expect(filterAssistantText(reply)).toBe("Done — accessories added. " + lowercaseQuestion);
  });
});

describe("createChatRoutes POST /chat – fake streaming and filtering (#327)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("saves the filtered text to the database, not the raw text with timestamp", async () => {
    const harness = makeRouteHarness({ assistantReply: "[2026-04-17T10:00:00.000Z] Great choice for today!" });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "What should I wear?" });

    expect(harness.spies.appendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "assistant",
      "Great choice for today!"
    );
  });

  it("saves normal text unchanged when no timestamp is present", async () => {
    const harness = makeRouteHarness({ assistantReply: "Here are some outfit ideas." });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Suggest an outfit." });

    expect(harness.spies.appendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "assistant",
      "Here are some outfit ideas."
    );
  });

  it("saves the trimmed text to the database when a trailing reasoning leak follows the add-accessories anchor (#360)", async () => {
    const anchor =
      "For future recommendations, would you like me to (a) let you decide, or (b) always include accessories?";
    const leakedReply =
      "Done — I added a necklace to the second outfit. " +
      anchor +
      "\nI'll call the process.\n\nWe need to answer the user's last message...";
    const harness = makeRouteHarness({ assistantReply: leakedReply });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Add accessories to the second outfit." });

    expect(harness.spies.appendMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "assistant",
      "Done — I added a necklace to the second outfit. " + anchor
    );
  });

});

describe("createChatRoutes POST /chat – route-level timezone extraction and priority (#339)", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("prefers userLocation.timezone over top-level timezone when both are present", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, {
      message: "Suggest an outfit.",
      timezone: "Asia/Tokyo",
      userLocation: { lat: 40.7128, lon: -74.006, timezone: "America/New_York" }
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain('get_current_time with timezone "America/New_York"');
    expect(systemMessage).not.toContain("Asia/Tokyo");
    expect(systemMessage).toContain("Location is available");
  });

  it("uses location-unavailable branch and passes top-level timezone to Step 2 when userLocation is absent", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, {
      message: "Suggest an outfit.",
      timezone: "Asia/Tokyo"
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Location is not available from the browser");
    expect(systemMessage).toContain('get_current_time with timezone "Asia/Tokyo"');
  });

  it("uses location-available branch and userLocation.timezone when only userLocation is provided", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, {
      message: "Suggest an outfit.",
      userLocation: { lat: 35.6762, lon: 139.6503, timezone: "Asia/Tokyo" }
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Location is available");
    expect(systemMessage).toContain('get_current_time with timezone "Asia/Tokyo"');
  });
});
