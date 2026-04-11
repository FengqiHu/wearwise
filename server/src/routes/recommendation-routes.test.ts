import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import { createRecommendationRoutes } from "./recommendation-routes.js";
import type { RecommendationRecord, UserRecord } from "../types/domain.js";

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

/** Flush the microtask/timer queue so fire-and-forget IIFEs can complete. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
      updateVote: recommendationRepository.updateVote as ReturnType<typeof vi.fn>,
      findVotedByUser: recommendationRepository.findVotedByUser as ReturnType<typeof vi.fn>,
      findUser: userRepository.findById as ReturnType<typeof vi.fn>,
      updateProfile: userRepository.updateProfile as ReturnType<typeof vi.fn>,
      summarizeStyle: geminiRecommendationService.summarizeStyle as ReturnType<typeof vi.fn>
    }
  };
}

describe("createRecommendationRoutes PATCH /recommendations/:recommendationId/vote", () => {
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
    await flushAsync();

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
    await flushAsync();

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
    await flushAsync();
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
    await flushAsync();

    expect(harness.spies.summarizeStyle).toHaveBeenCalledOnce();
    expect(harness.spies.updateProfile).not.toHaveBeenCalled();
  });
});
