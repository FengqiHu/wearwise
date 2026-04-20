import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { ChatService } from "../services/chat-service.js";
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
      streamChat: (chatService as unknown as { streamChat: ReturnType<typeof vi.fn> }).streamChat,
      createConversation: (conversationRepository as unknown as { createWithFirstUserMessage: ReturnType<typeof vi.fn> }).createWithFirstUserMessage,
      findConversation: (conversationRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      deleteConversation: (conversationRepository as unknown as { deleteById: ReturnType<typeof vi.fn> }).deleteById,
      appendMessage: (conversationRepository as unknown as { appendMessage: ReturnType<typeof vi.fn> }).appendMessage,
      updateConversationFields: (conversationRepository as unknown as { updateConversationFields: ReturnType<typeof vi.fn> }).updateConversationFields,
      findLatestAssistantRecommendationMessage: (conversationRepository as unknown as { findLatestAssistantRecommendationMessage: ReturnType<typeof vi.fn> }).findLatestAssistantRecommendationMessage,
      findRecommendationById: (recommendationRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      deleteRecommendationsByConversation: (recommendationRepository as unknown as { deleteByConversation: ReturnType<typeof vi.fn> }).deleteByConversation,
      listClosetItems: (closetRepository as unknown as { listByUser: ReturnType<typeof vi.fn> }).listByUser,
      findUser: (userRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      summarizeStyle: (geminiRecommendationService as unknown as { summarizeStyle: ReturnType<typeof vi.fn> }).summarizeStyle
    }
  };
}

describe("createChatRoutes POST /chat – sex in system prompt", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("includes the user's sex in the system message when set on the profile", async () => {
    const harness = makeRouteHarness({
      userRecord: makeUserRecord({
        profile: {
          name: "Taylor",
          heightCm: 180,
          weightKg: 75,
          styleNote: "minimal streetwear",
          avatarUrl: null,
          fullBodyImageUrl: null,
          headshotImageUrl: null,
          sex: "female"
        }
      })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("- Sex: female");
  });

  it("shows 'not specified' for sex when the profile has no sex set", async () => {
    const harness = makeRouteHarness({
      userRecord: makeUserRecord({
        profile: {
          name: "Taylor",
          heightCm: 180,
          weightKg: 75,
          styleNote: "minimal streetwear",
          avatarUrl: null,
          fullBodyImageUrl: null,
          headshotImageUrl: null
        }
      })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Recommend an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("- Sex: not specified");
  });
});

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

describe("createChatRoutes POST /chat – weather and occasion instructions in system message", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("includes weather-aware recommendation instructions in the system message", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Suggest an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("get_weather");
    expect(systemMessage).toContain("weather");
  });

  it("includes occasion-awareness instructions in the system message", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Suggest an outfit." })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Pre-recommendation checklist");
    expect(systemMessage).toContain("get_current_time");
  });

  it("includes the user's timezone in the occasion instruction when provided", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Suggest an outfit.",
        userLocation: { lat: 40.7128, lon: -74.006, timezone: "America/New_York" }
      })
    });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("America/New_York");
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
    expect(await response.text()).toBe('```json\n{"outfits":[]}\n```');

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

  it("includes the 3-outfit JSON schema instruction in the system message", async () => {
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

  it('excludes accessory items from the wardrobe context when accessoryMode is "exclude"', async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", name: "Ready Shirt", category: "tops" }),
        makeClosetItem({ id: "ready-accessory", name: "Silver Watch", category: "accessories", tags: ["silver"] }),
        makeClosetItem({ id: "ready-shoe", name: "Ready Loafers", category: "shoes" })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, {
      message: "Build me an outfit with no accessories.",
      accessoryMode: "exclude"
    });

    expect(response.status).toBe(200);
    await response.text();

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";

    expect(systemMessage).toContain("Wardrobe (2 items):");
    expect(systemMessage).toContain("ID: ready-top | Name: Ready Shirt");
    expect(systemMessage).toContain("ID: ready-shoe | Name: Ready Loafers");
    expect(systemMessage).not.toContain("Silver Watch");
    expect(systemMessage).toContain("Do NOT include any accessories");
  });

  it('includes accessory items and requires them in outfits when accessoryMode is "include"', async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", name: "Ready Shirt", category: "tops" }),
        makeClosetItem({ id: "ready-accessory", name: "Silver Watch", category: "accessories", tags: ["silver"] }),
        makeClosetItem({ id: "ready-shoe", name: "Ready Loafers", category: "shoes" })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, {
      message: "Build me an outfit with accessories.",
      accessoryMode: "include"
    });

    expect(response.status).toBe(200);
    await response.text();

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";

    expect(systemMessage).toContain("Wardrobe (3 items):");
    expect(systemMessage).toContain("ID: ready-accessory | Name: Silver Watch | Category: accessories");
    expect(systemMessage).toContain("Every outfit MUST include at least one accessory item");
  });

  it('defaults accessoryMode to "auto" when omitted', async () => {
    const harness = makeRouteHarness({
      closetItems: [
        makeClosetItem({ id: "ready-top", name: "Ready Shirt", category: "tops" }),
        makeClosetItem({ id: "ready-accessory", name: "Silver Watch", category: "accessories", tags: ["silver"] })
      ]
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postChat(started.baseUrl, {
      message: "Build me an outfit and decide on accessories."
    });

    expect(response.status).toBe(200);
    await response.text();

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";

    expect(systemMessage).toContain("Wardrobe (2 items):");
    expect(systemMessage).toContain("ID: ready-accessory | Name: Silver Watch | Category: accessories");
    expect(systemMessage).toContain("Use your own judgment on whether to include accessories");
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

  it("reflects the conversation's pendingConfirmation in the system prompt", async () => {
    const harness = makeRouteHarness();
    harness.spies.createConversation.mockResolvedValue(
      makeConversationRecord({
        pendingConfirmation: { type: "addAccessoriesOffer", createdAt: "2026-04-01T00:00:00.000Z" }
      })
    );
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Recommend an outfit." });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Pending confirmation state for this conversation: addAccessoriesOffer");
    expect(systemMessage).toContain("Add-accessories-back flow");
    expect(systemMessage).toContain("add_accessories_to_recommendation");
  });

  it("includes the intent-recognition flow instructions in the system prompt", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postChat(started.baseUrl, { message: "Hello" });

    const systemMessage = harness.getCapturedStreamInput()?.messages[0]?.content ?? "";
    expect(systemMessage).toContain("Accessory Mode Intent Recognition");
    expect(systemMessage).toContain("set_accessory_mode");
    expect(systemMessage).toContain("(a) include accessories");
    expect(systemMessage).toContain("(b) exclude accessories");
    expect(systemMessage).toContain("(c) let me decide");
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
