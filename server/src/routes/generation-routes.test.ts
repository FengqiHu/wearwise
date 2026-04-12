import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { GenerationRepository } from "../repositories/generation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { ImageGenerationService } from "../services/image-generation-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import { createGenerationRoutes } from "./generation-routes.js";
import type { ClosetItemRecord, RecommendationRecord, UserRecord } from "../types/domain.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

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
      fullBodyImageUrl: "https://cdn.example.com/body.jpg",
      headshotImageUrl: null
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeClosetItem(overrides: Partial<ClosetItemRecord> = {}): ClosetItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    imageUrl: "https://cdn.example.com/item.jpg",
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeHarness(options: {
  userRecord?: UserRecord;
  recommendation?: RecommendationRecord | null;
  closetItem?: ClosetItemRecord | null;
  imageConfigured?: boolean;
} = {}) {
  const userRecord = options.userRecord ?? makeUserRecord();
  const recommendation = options.recommendation !== undefined
    ? options.recommendation
    : makeRecommendationRecord();
  const closetItem = options.closetItem !== undefined
    ? options.closetItem
    : makeClosetItem();
  const imageConfigured = options.imageConfigured ?? true;

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({ user: userRecord, error: null })
  } as unknown as AuthService;

  const userRepository = {
    findById: vi.fn().mockResolvedValue(userRecord)
  } as unknown as UserRepository;

  const closetRepository = {
    findById: vi.fn().mockResolvedValue(closetItem)
  } as unknown as ClosetRepository;

  const generationRepository = {
    create: vi.fn().mockResolvedValue({ id: "gen-1" })
  } as unknown as GenerationRepository;

  const recommendationRepository = {
    findById: vi.fn().mockResolvedValue(recommendation),
    updateGeneration: vi.fn().mockResolvedValue({ ...recommendation, generation: { imageUrl: "https://cdn.example.com/out.png", createdAt: "2026-01-01T00:00:00.000Z" } })
  } as unknown as RecommendationRepository;

  const imageGenerationService = {
    isConfigured: vi.fn().mockReturnValue(imageConfigured),
    generateOutfitImage: vi.fn().mockResolvedValue(Buffer.from("fake-image"))
  } as unknown as ImageGenerationService;

  const r2StorageService = {
    buildGeneratedImageKey: vi.fn().mockReturnValue("generated/user-1/out.png"),
    uploadBuffer: vi.fn().mockResolvedValue("https://cdn.example.com/out.png")
  } as unknown as R2StorageService;

  return {
    dependencies: {
      authService,
      userRepository,
      closetRepository,
      generationRepository,
      recommendationRepository,
      imageGenerationService,
      r2StorageService
    },
    spies: {
      authResolve: authService.resolveAuthenticatedUser as ReturnType<typeof vi.fn>,
      findRecommendation: recommendationRepository.findById as ReturnType<typeof vi.fn>,
      updateGeneration: recommendationRepository.updateGeneration as ReturnType<typeof vi.fn>,
      findClosetItem: closetRepository.findById as ReturnType<typeof vi.fn>,
      findUser: userRepository.findById as ReturnType<typeof vi.fn>,
      saveGeneration: generationRepository.create as ReturnType<typeof vi.fn>,
      generateImage: imageGenerationService.generateOutfitImage as ReturnType<typeof vi.fn>,
      uploadBuffer: r2StorageService.uploadBuffer as ReturnType<typeof vi.fn>
    }
  };
}

async function startServer(dependencies: ReturnType<typeof makeHarness>["dependencies"]): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createGenerationRoutes(dependencies));
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

async function postGenerate(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/generate/outfit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createGenerationRoutes POST /generate/outfit – auth and validation", () => {
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

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(res.status).toBe(401);
  });

  it("returns 503 when image generation service is not configured", async () => {
    const harness = makeHarness({ imageConfigured: false });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(res.status).toBe(503);
  });

  it("returns 400 when neither recommendationId nor clothingItemIds provided", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, {});

    expect(res.status).toBe(400);
  });

  it("returns 400 when clothingItemIds is an empty array and no recommendationId", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { clothingItemIds: [] });

    expect(res.status).toBe(400);
  });
});

describe("createGenerationRoutes POST /generate/outfit – recommendationId flow", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  it("returns 404 when recommendation does not exist", async () => {
    const harness = makeHarness({ recommendation: null });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-missing" });

    expect(res.status).toBe(404);
  });

  it("returns 422 when user has no body image", async () => {
    const harness = makeHarness({
      userRecord: makeUserRecord({
        profile: {
          name: "Taylor",
          heightCm: 170,
          weightKg: 65,
          styleNote: "casual",
          avatarUrl: null,
          fullBodyImageUrl: null,
          headshotImageUrl: null
        }
      })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(res.status).toBe(422);
  });

  it("returns 422 when a clothing item has no image", async () => {
    const harness = makeHarness({ closetItem: makeClosetItem({ imageUrl: null }) });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(res.status).toBe(422);
  });

  it("returns 422 when a clothing item does not exist", async () => {
    const harness = makeHarness({ closetItem: null });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(res.status).toBe(422);
  });

  it("returns 200 with imageUrl and updates recommendation generation", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; result: { imageUrl: string; generatedAt: string } };
    expect(body.success).toBe(true);
    expect(body.result.imageUrl).toBe("https://cdn.example.com/out.png");
  });

  it("updates recommendation.generation in place after successful generation", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(harness.spies.updateGeneration).toHaveBeenCalledOnce();
    expect(harness.spies.updateGeneration).toHaveBeenCalledWith(
      "user-1",
      "rec-1",
      expect.objectContaining({ imageUrl: "https://cdn.example.com/out.png" })
    );
  });

  it("resolves item IDs from the recommendation record", async () => {
    const rec = makeRecommendationRecord({ items: [{ id: "shirt-1", name: "Linen Shirt" }, { id: "pants-1", name: "Chinos" }] });
    const harness = makeHarness({ recommendation: rec });
    harness.spies.findClosetItem.mockResolvedValue(makeClosetItem({ imageUrl: "https://cdn.example.com/item.jpg" }));
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(harness.spies.findClosetItem).toHaveBeenCalledWith("user-1", "shirt-1");
    expect(harness.spies.findClosetItem).toHaveBeenCalledWith("user-1", "pants-1");
  });

  it("logs the generation to the generation repository", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postGenerate(started.baseUrl, { recommendationId: "rec-1" });

    expect(harness.spies.saveGeneration).toHaveBeenCalledOnce();
    expect(harness.spies.saveGeneration).toHaveBeenCalledWith(
      "user-1",
      ["item-1"],
      "https://cdn.example.com/out.png"
    );
  });
});

describe("createGenerationRoutes POST /generate/outfit – direct clothingItemIds flow", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  it("returns 200 with imageUrl when clothingItemIds are provided directly", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const res = await postGenerate(started.baseUrl, { clothingItemIds: ["item-1"] });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; result: { imageUrl: string } };
    expect(body.success).toBe(true);
    expect(body.result.imageUrl).toBe("https://cdn.example.com/out.png");
  });

  it("does not look up or update any recommendation when using clothingItemIds directly", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postGenerate(started.baseUrl, { clothingItemIds: ["item-1"] });

    expect(harness.spies.findRecommendation).not.toHaveBeenCalled();
    expect(harness.spies.updateGeneration).not.toHaveBeenCalled();
  });

  it("still logs the generation to the generation repository", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postGenerate(started.baseUrl, { clothingItemIds: ["item-1"] });

    expect(harness.spies.saveGeneration).toHaveBeenCalledOnce();
  });
});
