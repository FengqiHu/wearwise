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
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import {
  ClothingPresenceRejectedError,
  ClothingPresenceUnavailableError
} from "../services/gemini-clothing-presence-service.js";
import type { ImageGenerationService } from "../services/image-generation-service.js";
import {
  ImageModerationRejectedError,
  ImageModerationUnavailableError
} from "../services/image-moderation-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { ReviewedImageStorageService } from "../services/reviewed-image-storage-service.js";
import type { ClosetItemRecord, RecommendationRecord, UserRecord } from "../types/domain.js";
import { createClosetRoutes } from "./closet-routes.js";
import { createShopRoutes } from "./shop-routes.js";

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
    id: "shoe-1",
    userId: "user-1",
    imageUrl: "https://cdn.example.com/closet/shoe-1.jpg",
    analysisStatus: "ready",
    analysisError: null,
    name: "White Sneakers",
    category: "shoes",
    tags: ["casual"],
    description: "Clean white sneakers.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeRecommendationRecord(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    id: "rec-1",
    userId: "user-1",
    outfitName: "Shop Try-On",
    reason: "Shop Try-On",
    items: [],
    occasions: [],
    weather: null,
    generation: null,
    vote: null,
    conversationId: "",
    messageId: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeHarness(options: {
  authenticated?: boolean;
  wardrobe?: ClosetItemRecord[];
  closetItem?: ClosetItemRecord | null;
  storageConfigured?: boolean;
  extractionConfigured?: boolean;
  recommendationConfigured?: boolean;
  imageConfigured?: boolean;
  userRecord?: UserRecord;
} = {}) {
  const userRecord = options.userRecord ?? makeUserRecord();
  const wardrobe = options.wardrobe ?? [makeClosetItem()];
  const closetItem = options.closetItem !== undefined ? options.closetItem : wardrobe[0] ?? null;

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue(
      options.authenticated === false
        ? { user: null, error: { status: 401, message: "Unauthorized." } }
        : { user: userRecord, error: null }
    )
  } as unknown as AuthService;

  const closetRepository = {
    listByUser: vi.fn().mockResolvedValue(wardrobe),
    create: vi.fn().mockResolvedValue(makeClosetItem({ id: "created-closet-item" })),
    importMany: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(closetItem),
    updateExtraction: vi.fn(),
    updateMetadata: vi.fn(),
    deleteById: vi.fn(),
    updateImage: vi.fn()
  } as unknown as ClosetRepository;

  const r2StorageService = {
    isConfigured: vi.fn().mockReturnValue(options.storageConfigured ?? true),
    publicUrlForKey: vi.fn((key: string) => `https://cdn.example.com/${key}`),
    buildGeneratedImageKey: vi.fn().mockReturnValue("users/user-1/generated_images/shop-tryon.png"),
    uploadBuffer: vi.fn().mockResolvedValue("https://cdn.example.com/generated/shop-tryon.png"),
    presignClosetImageUpload: vi.fn(),
    ownsPublicUrl: vi.fn().mockReturnValue(true),
    deleteObject: vi.fn()
  } as unknown as R2StorageService;

  const geminiExtractionService = {
    isConfigured: vi.fn().mockReturnValue(options.extractionConfigured ?? true),
    analyzeClothingImage: vi.fn().mockResolvedValue({
      name: "Striped Shirt",
      category: "tops",
      tags: ["striped", "cotton"],
      description: "A striped cotton shirt."
    })
  } as unknown as GeminiExtractionService;

  const geminiRecommendationService = {
    isConfigured: vi.fn().mockReturnValue(options.recommendationConfigured ?? true),
    recommendShopOutfits: vi.fn().mockResolvedValue({
      outfits: [
        {
          styleNote: "A clean weekend outfit.",
          selections: [
            { category: "shoes", itemId: "shoe-1", reason: "They keep the look casual." }
          ]
        }
      ]
    }),
    recommendOutfit: vi.fn()
  } as unknown as GeminiRecommendationService;

  const userRepository = {
    findById: vi.fn().mockResolvedValue(userRecord)
  } as unknown as UserRepository;

  const imageGenerationService = {
    isConfigured: vi.fn().mockReturnValue(options.imageConfigured ?? true),
    generateOutfitImage: vi.fn().mockResolvedValue(Buffer.from("generated-image"))
  } as unknown as ImageGenerationService;

  const generationRepository = {
    create: vi.fn().mockResolvedValue({ id: "generation-1" })
  } as unknown as GenerationRepository;

  const recommendationRepository = {
    create: vi.fn().mockResolvedValue(makeRecommendationRecord()),
    updateGeneration: vi.fn().mockResolvedValue(makeRecommendationRecord())
  } as unknown as RecommendationRepository;

  const reviewedImageStorageService = {
    isClosetImageReviewConfigured: vi.fn().mockReturnValue(options.storageConfigured ?? true),
    storeUserImage: vi.fn().mockResolvedValue({
      key: "user-1/closet/test-upload.jpg",
      publicUrl: "https://cdn.example.com/user-1/closet/test-upload.jpg"
    }),
    storeUserShopImage: vi.fn().mockResolvedValue({
      key: "user-1/online-items/product.png",
      publicUrl: "https://cdn.example.com/user-1/online-items/product.png"
    })
  } as unknown as ReviewedImageStorageService;

  return {
    dependencies: {
      authService,
      closetRepository,
      geminiExtractionService,
      geminiRecommendationService,
      r2StorageService,
      userRepository,
      imageGenerationService,
      generationRepository,
      recommendationRepository,
      reviewedImageStorageService
    },
    spies: {
      authResolve: authService.resolveAuthenticatedUser as ReturnType<typeof vi.fn>,
      listWardrobe: closetRepository.listByUser as ReturnType<typeof vi.fn>,
      createClosetItem: closetRepository.create as ReturnType<typeof vi.fn>,
      importClosetItems: closetRepository.importMany as ReturnType<typeof vi.fn>,
      findClosetItem: closetRepository.findById as ReturnType<typeof vi.fn>,
      storeUserShopImage: (reviewedImageStorageService as unknown as { storeUserShopImage: ReturnType<typeof vi.fn> }).storeUserShopImage,
      analyzeImage: geminiExtractionService.analyzeClothingImage as ReturnType<typeof vi.fn>,
      recommendShopOutfits: geminiRecommendationService.recommendShopOutfits as ReturnType<typeof vi.fn>,
      generateImage: imageGenerationService.generateOutfitImage as ReturnType<typeof vi.fn>,
      saveGeneration: generationRepository.create as ReturnType<typeof vi.fn>,
      createRecommendation: recommendationRepository.create as ReturnType<typeof vi.fn>,
      updateGeneration: recommendationRepository.updateGeneration as ReturnType<typeof vi.fn>
    }
  };
}

async function startServer(dependencies: ReturnType<typeof makeHarness>["dependencies"]): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createShopRoutes(dependencies));
  app.use("/api", createClosetRoutes(dependencies));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });
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

function imageFormData(type = "image/png"): FormData {
  const form = new FormData();
  form.append("image", new Blob([Buffer.from("fake-image")], { type }), "product.png");
  return form;
}

async function postRecommend(baseUrl: string, body: BodyInit): Promise<Response> {
  return fetch(`${baseUrl}/api/shop/recommend`, {
    method: "POST",
    body
  });
}

describe("createShopRoutes POST /shop/recommend", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  it("returns recommendations after a successful product upload", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());

    expect(response.status).toBe(200);
    const body = await response.json() as {
      product: { key: string; name: string };
      outfits: Array<{ styleNote: string; items: Array<{ id: string; isUserSelected: boolean; reason: string | null }> }>;
    };
    expect(body.product).toEqual(expect.objectContaining({
      key: "user-1/online-items/product.png",
      name: "Striped Shirt"
    }));
    expect(body.outfits[0]!.items).toEqual([
      expect.objectContaining({ id: "user-1/online-items/product.png", isUserSelected: true, reason: null }),
      expect.objectContaining({ id: "shoe-1", isUserSelected: false, reason: "They keep the look casual." })
    ]);
  });

  it("rejects an invalid image upload", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData("text/plain"));
    const body = await response.json() as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("Unsupported image type");
    expect(harness.spies.storeUserShopImage).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated request", async () => {
    const harness = makeHarness({ authenticated: false });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());

    expect(response.status).toBe(401);
    expect(harness.spies.storeUserShopImage).not.toHaveBeenCalled();
  });

  it("returns a product-only outfit when the user wardrobe has no ready pairings", async () => {
    const harness = makeHarness({ wardrobe: [] });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());

    expect(response.status).toBe(200);
    const body = await response.json() as { outfits: Array<{ styleNote: string; items: Array<{ id: string }> }> };
    expect(body.outfits).toHaveLength(1);
    expect(body.outfits[0]!.styleNote).toContain("Add analyzed items");
    expect(body.outfits[0]!.items).toEqual([
      expect.objectContaining({ id: "user-1/online-items/product.png" })
    ]);
    expect(harness.spies.recommendShopOutfits).not.toHaveBeenCalled();
  });

  it("analyzes the uploaded product image with Gemini before building recommendations", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postRecommend(started.baseUrl, imageFormData("image/webp"));

    expect(harness.spies.storeUserShopImage).toHaveBeenCalledWith({
      userId: "user-1",
      fileName: "product.png",
      contentType: "image/webp",
      buffer: expect.any(Buffer)
    });
    expect(harness.spies.analyzeImage).toHaveBeenCalledWith(
      "https://cdn.example.com/user-1/online-items/product.png",
      "image/webp"
    );
    expect(harness.spies.recommendShopOutfits).toHaveBeenCalledWith({
      productItem: expect.objectContaining({
        id: "user-1/online-items/product.png",
        category: "tops",
        name: "Striped Shirt"
      }),
      wardrobeByCategory: {
        shoes: [
          expect.objectContaining({
            id: "shoe-1",
            category: "shoes",
            name: "White Sneakers"
          })
        ]
      }
    });
  });

  it("does not add the uploaded product image to the user's wardrobe", async () => {
    const closetItems = [
      makeClosetItem({ id: "shoe-1", imageUrl: "https://cdn.example.com/closet/shoe-1.jpg" })
    ];
    const harness = makeHarness({ wardrobe: closetItems });
    const started = await startServer(harness.dependencies);
    server = started.server;

    await postRecommend(started.baseUrl, imageFormData());
    const closetResponse = await fetch(`${started.baseUrl}/api/closet/items`);
    const closetBody = await closetResponse.json() as { items: ClosetItemRecord[] };

    expect(closetResponse.status).toBe(200);
    expect(closetBody.items).toHaveLength(1);
    expect(closetBody.items[0]!.id).toBe("shoe-1");
    expect(closetBody.items[0]!.imageUrl).toBe("https://cdn.example.com/closet/shoe-1.jpg");
    expect(closetBody.items.some((item) => item.imageUrl.includes("online-items"))).toBe(false);
    expect(harness.spies.createClosetItem).not.toHaveBeenCalled();
    expect(harness.spies.importClosetItems).not.toHaveBeenCalled();
  });

  it("returns 503 when reviewed shop image storage is not configured", async () => {
    const harness = makeHarness({ storageConfigured: false });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());
    const body = await response.json() as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("Image review service");
    expect(harness.spies.storeUserShopImage).not.toHaveBeenCalled();
    expect(harness.spies.analyzeImage).not.toHaveBeenCalled();
  });

  it("returns 422 when SafeSearch rejects the shop image", async () => {
    const harness = makeHarness();
    harness.spies.storeUserShopImage.mockRejectedValue(
      new ImageModerationRejectedError(
        "This image could not be uploaded because it appears to violate WearWise's image safety policy. Please choose a different image.",
        ["adult"],
        {}
      )
    );
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());
    const body = await response.json() as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain("image safety policy");
    expect(harness.spies.analyzeImage).not.toHaveBeenCalled();
    expect(harness.spies.recommendShopOutfits).not.toHaveBeenCalled();
  });

  it("returns 503 when SafeSearch is unavailable for the shop image", async () => {
    const harness = makeHarness();
    harness.spies.storeUserShopImage.mockRejectedValue(new ImageModerationUnavailableError("SafeSearch unavailable."));
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());
    const body = await response.json() as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("SafeSearch unavailable");
    expect(harness.spies.analyzeImage).not.toHaveBeenCalled();
  });

  it("returns 422 when Gemini rejects the shop image because no clothing is visible", async () => {
    const harness = makeHarness();
    harness.spies.storeUserShopImage.mockRejectedValue(
      new ClothingPresenceRejectedError("No clothing item is visible.")
    );
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());
    const body = await response.json() as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain("no clothing item was detected");
    expect(harness.spies.analyzeImage).not.toHaveBeenCalled();
    expect(harness.spies.recommendShopOutfits).not.toHaveBeenCalled();
  });

  it("returns 503 when Gemini clothing validation is unavailable for the shop image", async () => {
    const harness = makeHarness();
    harness.spies.storeUserShopImage.mockRejectedValue(new ClothingPresenceUnavailableError());
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postRecommend(started.baseUrl, imageFormData());
    const body = await response.json() as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("temporarily unavailable");
    expect(harness.spies.analyzeImage).not.toHaveBeenCalled();
  });
});

describe("createShopRoutes POST /shop/try-on", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  function postTryOn(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${baseUrl}/api/shop/try-on`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("returns 200 with a generated try-on image URL on success", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, {
      productKey: "user-1/online-items/product.png",
      outfitName: "Weekend Look",
      productName: "Striped Shirt"
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof (body.result as Record<string, unknown>).imageUrl).toBe("string");
    expect(harness.spies.generateImage).toHaveBeenCalledOnce();
    expect(harness.spies.saveGeneration).toHaveBeenCalledWith(
      "user-1",
      expect.any(Array),
      expect.stringContaining("https://")
    );
  });

  it("returns 401 when not authenticated", async () => {
    const harness = makeHarness({ authenticated: false });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, {
      productKey: "user-1/online-items/product.png"
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("returns 503 when image generation service is not configured", async () => {
    const harness = makeHarness({ imageConfigured: false });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, {
      productKey: "user-1/online-items/product.png"
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(harness.spies.generateImage).not.toHaveBeenCalled();
  });

  it("returns 400 when productKey is missing", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, { outfitName: "Look" });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("returns 403 when productKey does not belong to the current user", async () => {
    const harness = makeHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, {
      productKey: "other-user/online-items/product.png"
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it("returns 422 when user has no full-body photo", async () => {
    const harness = makeHarness({
      userRecord: makeUserRecord({ profile: { name: "Taylor", heightCm: 170, weightKg: 65, styleNote: "", avatarUrl: null, fullBodyImageUrl: null, headshotImageUrl: null } })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, {
      productKey: "user-1/online-items/product.png"
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.message).toContain("full-body photo");
  });

  it("includes wardrobe item images when clothingItemIds are provided", async () => {
    const wardrobeItem = makeClosetItem({ id: "pants-1", imageUrl: "https://cdn.example.com/closet/pants-1.jpg" });
    const harness = makeHarness({ closetItem: wardrobeItem });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postTryOn(started.baseUrl, {
      productKey: "user-1/online-items/product.png",
      clothingItemIds: ["pants-1"]
    });

    expect(response.status).toBe(200);
    expect(harness.spies.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        clothingImageUrls: expect.arrayContaining([
          "https://cdn.example.com/user-1/online-items/product.png",
          "https://cdn.example.com/closet/pants-1.jpg"
        ])
      })
    );
  });
});
