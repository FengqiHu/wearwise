import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import { createRecommendationRoutes } from "./recommendation-routes.js";
import type { ClosetItemRecord, ConversationRecord, RecommendationRecord, UserRecord } from "../types/domain.js";

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-1",
    email: "test@example.com",
    name: "Taylor",
    picture: null,
    profile: {
      name: "Taylor",
      heightCm: 170,
      weightKg: 65,
      styleNote: "casual",
      avatarUrl: null,
      fullBodyImageUrl: null,
      headshotImageUrl: null
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeRecommendationRecord(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    id: "rec-1",
    userId: "user-1",
    outfitName: "Casual Look",
    reason: "Comfortable and stylish",
    items: [{ id: "item-1", name: "Blue Shirt" }],
    occasions: [],
    generation: null,
    vote: null,
    conversationId: "conv-1",
    messageId: "msg-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeGeneratedRecommendationRecord(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return makeRecommendationRecord({
    generation: {
      imageUrl: "https://cdn.example.com/generated-look.png",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    ...overrides
  });
}

async function startServer(dependencies: {
  authService: AuthService;
  recommendationRepository: RecommendationRepository;
  userRepository: UserRepository;
  geminiRecommendationService: GeminiRecommendationService;
  conversationRepository: ConversationRepository;
  closetRepository: ClosetRepository;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createRecommendationRoutes(dependencies));
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

/** Advance fake timers past the 10 s throttle window and drain all promises. */
async function advancePastThrottle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(10_000);
}

function makeHarness(options: {
  userRecord?: UserRecord;
  updatedRec?: RecommendationRecord | null;
  votedRecs?: RecommendationRecord[];
  styleNote?: string;
} = {}) {
  const userRecord = options.userRecord ?? makeUserRecord();
  const updatedRec = options.updatedRec !== undefined
    ? options.updatedRec
    : makeRecommendationRecord({ vote: "up" });
  const votedRecs = options.votedRecs ?? [makeRecommendationRecord({ vote: "up" })];
  const styleNote = options.styleNote ?? "Prefers casual styles";

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({ user: userRecord, error: null })
  } as unknown as AuthService;

  const recommendationRepository = {
    listByUser: vi.fn().mockResolvedValue([]),
    updateVote: vi.fn().mockResolvedValue(updatedRec),
    findVotedByUser: vi.fn().mockResolvedValue(votedRecs)
  } as unknown as RecommendationRepository;

  const conversationRepository = {
    findById: vi.fn().mockResolvedValue(null)
  } as unknown as ConversationRepository;

  const closetRepository = {
    findByIds: vi.fn().mockResolvedValue([])
  } as unknown as ClosetRepository;

  const userRepository = {
    findById: vi.fn().mockResolvedValue(userRecord),
    updateProfile: vi.fn().mockResolvedValue(userRecord)
  } as unknown as UserRepository;

  const geminiRecommendationService = {
    summarizeStyle: vi.fn().mockResolvedValue(styleNote)
  } as unknown as GeminiRecommendationService;

  return {
    dependencies: {
      authService,
      recommendationRepository,
      userRepository,
      geminiRecommendationService,
      conversationRepository,
      closetRepository
    },
    spies: {
      authResolve: authService.resolveAuthenticatedUser as ReturnType<typeof vi.fn>,
      listByUser: recommendationRepository.listByUser as ReturnType<typeof vi.fn>,
      updateVote: recommendationRepository.updateVote as ReturnType<typeof vi.fn>,
      findVotedByUser: recommendationRepository.findVotedByUser as ReturnType<typeof vi.fn>,
      findByIds: closetRepository.findByIds as ReturnType<typeof vi.fn>,
      conversationFindById: conversationRepository.findById as ReturnType<typeof vi.fn>,
      findUser: userRepository.findById as ReturnType<typeof vi.fn>,
      updateProfile: userRepository.updateProfile as ReturnType<typeof vi.fn>,
      summarizeStyle: geminiRecommendationService.summarizeStyle as ReturnType<typeof vi.fn>
    }
  };
}

describe("createRecommendationRoutes PATCH /recommendations/:recommendationId/vote", () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const harness = makeHarness();
    harness.spies.authResolve.mockResolvedValue({
      user: null,
      error: { status: 401, message: "Unauthorized." }
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });

    expect(res.status).toBe(401);
  });

  it("returns 200 with updated recommendation for vote up", async () => {
    const updated = makeRecommendationRecord({ vote: "up" });
    const harness = makeHarness({ updatedRec: updated });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendation: RecommendationRecord };
    expect(body.recommendation.vote).toBe("up");
    expect(harness.spies.updateVote).toHaveBeenCalledWith("user-1", "rec-1", "up");
  });

  it("returns 200 with updated recommendation for vote down", async () => {
    const updated = makeRecommendationRecord({ vote: "down" });
    const harness = makeHarness({ updatedRec: updated });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "down" })
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendation: RecommendationRecord };
    expect(body.recommendation.vote).toBe("down");
    expect(harness.spies.updateVote).toHaveBeenCalledWith("user-1", "rec-1", "down");
  });

  it("returns 200 and clears vote when vote is null", async () => {
    const updated = makeRecommendationRecord({ vote: null });
    const harness = makeHarness({ updatedRec: updated });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: null })
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendation: RecommendationRecord };
    expect(body.recommendation.vote).toBeNull();
    expect(harness.spies.updateVote).toHaveBeenCalledWith("user-1", "rec-1", null);
  });

  it("returns 400 for invalid vote value", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "maybe" })
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("vote must be");
    expect(harness.spies.updateVote).not.toHaveBeenCalled();
  });

  it("returns 404 when recommendation not found", async () => {
    const harness = makeHarness({ updatedRec: null });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/nonexistent/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });

    expect(res.status).toBe(404);
    expect(harness.spies.updateVote).toHaveBeenCalledWith("user-1", "nonexistent", "up");
  });

  it("calling vote twice uses updateVote both times (updates, not duplicates)", async () => {
    const harness = makeHarness({ updatedRec: makeRecommendationRecord({ vote: "up" }) });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });

    harness.spies.updateVote.mockResolvedValue(makeRecommendationRecord({ vote: "down" }));

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "down" })
    });

    expect(res.status).toBe(200);
    expect(harness.spies.updateVote).toHaveBeenCalledTimes(2);
    expect(harness.spies.updateVote).toHaveBeenLastCalledWith("user-1", "rec-1", "down");
  });

  it("triggers summarizeStyle after successful vote when history exists", async () => {
    const votedRecs = [
      makeRecommendationRecord({ id: "rec-1", vote: "up" }),
      makeRecommendationRecord({ id: "rec-2", vote: "down" })
    ];
    const harness = makeHarness({ votedRecs });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });
    await advancePastThrottle();

    expect(harness.spies.summarizeStyle).toHaveBeenCalledOnce();
    expect(harness.spies.updateProfile).toHaveBeenCalledOnce();
  });

  it("does not call summarizeStyle when vote history is empty", async () => {
    const harness = makeHarness({ votedRecs: [] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });
    await advancePastThrottle();

    expect(harness.spies.summarizeStyle).not.toHaveBeenCalled();
    expect(harness.spies.updateProfile).not.toHaveBeenCalled();
  });

  it("does not surface summarizeStyle errors to the client", async () => {
    const harness = makeHarness();
    harness.spies.summarizeStyle.mockRejectedValue(new Error("Gemini unavailable"));
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });

    expect(res.status).toBe(200);
    await advancePastThrottle();
    // error is swallowed inside fire-and-forget — no unhandled rejection
  });

  it("does not update styleNote when summarizeStyle returns empty string", async () => {
    const harness = makeHarness({ styleNote: "" });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });
    await advancePastThrottle();

    expect(harness.spies.summarizeStyle).toHaveBeenCalledOnce();
    expect(harness.spies.updateProfile).not.toHaveBeenCalled();
  });

  it("coalesces rapid votes within the throttle window into a single summarizeStyle call", async () => {
    const harness = makeHarness({ votedRecs: [makeRecommendationRecord({ vote: "up" })] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    // Cast three votes back-to-back without advancing time
    for (const vote of ["up", "down", "up"] as const) {
      await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote })
      });
    }

    // Window is still open — no call yet
    expect(harness.spies.summarizeStyle).not.toHaveBeenCalled();

    // Advance to the end of the window — fires exactly once
    await advancePastThrottle();
    expect(harness.spies.summarizeStyle).toHaveBeenCalledOnce();
  });

  it("does not reset the throttle window when a new vote arrives mid-window", async () => {
    const harness = makeHarness({ votedRecs: [makeRecommendationRecord({ vote: "up" })] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    // First vote opens the 10 s window
    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });

    // Advance 5 s — halfway through the 10 s window, no call yet
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.spies.summarizeStyle).not.toHaveBeenCalled();

    // Second vote arrives mid-window — must NOT reset the timer
    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "down" })
    });

    // Advance another 5 s — now 10 s since the FIRST vote; window fires
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.spies.summarizeStyle).toHaveBeenCalledOnce();
  });

  it("calls findByIds with all item IDs from voted recommendations before summarizeStyle", async () => {
    const votedRecs = [
      makeRecommendationRecord({ id: "rec-1", vote: "up", items: [{ id: "item-1", name: "Blue Shirt" }, { id: "item-2", name: "Slim Chinos" }] }),
      makeRecommendationRecord({ id: "rec-2", vote: "down", items: [{ id: "item-3", name: "Leather Jacket" }] })
    ];
    const harness = makeHarness({ votedRecs });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });
    await advancePastThrottle();

    expect(harness.spies.findByIds).toHaveBeenCalledWith(
      "user-1",
      expect.arrayContaining(["item-1", "item-2", "item-3"])
    );
  });

  it("passes category and tags from closet items to summarizeStyle", async () => {
    const votedRecs = [
      makeRecommendationRecord({ id: "rec-1", vote: "up", items: [{ id: "item-1", name: "Blue Shirt" }] })
    ];
    const closetItem = makeClosetItem({ id: "item-1", name: "Blue Shirt", category: "tops", tags: ["blue", "cotton"] });

    const harness = makeHarness({ votedRecs });
    harness.spies.findByIds.mockResolvedValue([closetItem]);
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });
    await advancePastThrottle();

    expect(harness.spies.summarizeStyle).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ id: "item-1", category: "tops", tags: ["blue", "cotton"] })
          ])
        })
      ])
    );
  });

  it("omits deleted closet items (not returned by findByIds) from summarizeStyle input", async () => {
    const votedRecs = [
      makeRecommendationRecord({
        id: "rec-1", vote: "up",
        items: [
          { id: "item-exists", name: "Blue Shirt" },
          { id: "item-deleted", name: "Old Jacket" }
        ]
      })
    ];
    const closetItem = makeClosetItem({ id: "item-exists", name: "Blue Shirt", category: "tops", tags: [] });

    const harness = makeHarness({ votedRecs });
    harness.spies.findByIds.mockResolvedValue([closetItem]);
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: "up" })
    });
    await advancePastThrottle();

    const callArg = harness.spies.summarizeStyle.mock.calls[0]?.[0] as { items: { id: string }[] }[];
    const passedItems = callArg?.[0]?.items ?? [];
    expect(passedItems.map((i) => i.id)).toEqual(["item-exists"]);
    expect(passedItems.map((i) => i.id)).not.toContain("item-deleted");
  });

  it("opens a new throttle window after the previous one expires", async () => {
    const harness = makeHarness({ votedRecs: [makeRecommendationRecord({ vote: "up" })] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const vote = (v: "up" | "down") =>
      fetch(`${started.baseUrl}/api/recommendations/rec-1/vote`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: v })
      });

    // First window: vote → 10 s → 1st request
    await vote("up");
    await advancePastThrottle();
    expect(harness.spies.summarizeStyle).toHaveBeenCalledTimes(1);

    // Second window: vote → 10 s → 2nd request
    await vote("down");
    await advancePastThrottle();
    expect(harness.spies.summarizeStyle).toHaveBeenCalledTimes(2);
  });
});

function makeClosetItem(overrides: Partial<ClosetItemRecord> = {}): ClosetItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    imageUrl: "https://cdn.example.com/item-1.jpg",
    analysisStatus: "ready",
    analysisError: null,
    name: "Blue Shirt",
    category: "tops",
    tags: [],
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: "conv-1",
    userId: "user-1",
    title: "Weekend brunch outfit",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    accessoryMode: "auto",
    ...overrides
  };
}

describe("createRecommendationRoutes GET /recommendations/history", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    const harness = makeHarness();
    harness.spies.authResolve.mockResolvedValue({
      user: null,
      error: { status: 401, message: "Unauthorized." }
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(res.status).toBe(401);
  });

  it("returns empty array when user has no recommendations", async () => {
    const harness = makeHarness();
    harness.spies.listByUser.mockResolvedValue([]);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendations: unknown[] };
    expect(body.recommendations).toEqual([]);
  });

  it("returns recommendations with enriched items, occasions, conversationTitle, and vote", async () => {
    const rec = makeGeneratedRecommendationRecord({
      items: [{ id: "item-1", name: "Blue Shirt" }],
      occasions: ["casual"],
      vote: "up"
    });
    const closetItem = makeClosetItem({ id: "item-1", imageUrl: "https://cdn.example.com/item-1.jpg" });
    const conversation = makeConversation({ id: "conv-1", title: "Weekend brunch outfit" });

    const harness = makeHarness();
    harness.spies.listByUser.mockResolvedValue([rec]);
    harness.spies.findByIds.mockResolvedValue([closetItem]);
    harness.spies.conversationFindById.mockResolvedValue(conversation);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendations: Record<string, unknown>[] };
    const entry = body.recommendations[0]!;
    expect(entry.vote).toBe("up");
    expect(entry.conversationTitle).toBe("Weekend brunch outfit");
    expect(entry.occasions).toContain("casual");
    const items = entry.items as { id: string; imageUrl: string | null }[];
    expect(items[0]!.imageUrl).toBe("https://cdn.example.com/item-1.jpg");
  });

  it("filters out records without generation before enriching history", async () => {
    const generated = makeGeneratedRecommendationRecord({
      id: "rec-generated",
      items: [{ id: "item-1", name: "Blue Shirt" }],
      conversationId: "conv-generated"
    });
    const ungenerated = makeRecommendationRecord({
      id: "rec-ungenerated",
      items: [{ id: "item-ignored", name: "Ignored Shirt" }],
      conversationId: "conv-ignored"
    });

    const harness = makeHarness();
    harness.spies.listByUser.mockResolvedValue([ungenerated, generated]);
    harness.spies.findByIds.mockResolvedValue([]);
    harness.spies.conversationFindById.mockResolvedValue(null);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendations: { id: string }[] };
    expect(body.recommendations).toEqual([expect.objectContaining({ id: "rec-generated" })]);
    expect(harness.spies.findByIds).toHaveBeenCalledWith("user-1", ["item-1"]);
    expect(harness.spies.conversationFindById).toHaveBeenCalledWith("user-1", "conv-generated");
    expect(harness.spies.conversationFindById).not.toHaveBeenCalledWith("user-1", "conv-ignored");
  });

  it("sorts results by updatedAt descending", async () => {
    const older = makeGeneratedRecommendationRecord({ id: "rec-old", updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeGeneratedRecommendationRecord({ id: "rec-new", updatedAt: "2026-02-01T00:00:00.000Z" });

    const harness = makeHarness();
    harness.spies.listByUser.mockResolvedValue([older, newer]);
    harness.spies.findByIds.mockResolvedValue([]);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendations: { id: string }[] };
    expect(body.recommendations[0]!.id).toBe("rec-new");
    expect(body.recommendations[1]!.id).toBe("rec-old");
  });

  it("keeps occasions empty instead of falling back to conversationTitle", async () => {
    const rec = makeGeneratedRecommendationRecord({ occasions: [], conversationId: "conv-1" });
    const conversation = makeConversation({ id: "conv-1", title: "Date night look" });

    const harness = makeHarness();
    harness.spies.listByUser.mockResolvedValue([rec]);
    harness.spies.findByIds.mockResolvedValue([]);
    harness.spies.conversationFindById.mockResolvedValue(conversation);
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { recommendations: { occasions: string[] }[] };
    expect(body.recommendations[0]!.occasions).toEqual([]);
  });

  it("scopes results to the authenticated user", async () => {
    const harness = makeHarness();
    harness.spies.listByUser.mockResolvedValue([]);
    const started = await startServer(harness.dependencies);
    server = started.server;

    await fetch(`${started.baseUrl}/api/recommendations/history`);

    expect(harness.spies.listByUser).toHaveBeenCalledWith("user-1");
  });
});
