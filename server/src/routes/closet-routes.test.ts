import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClosetRoutes } from "./closet-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { ReviewedImageStorageService } from "../services/reviewed-image-storage-service.js";
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { ClosetItemRecord, UserRecord } from "../types/domain.js";
import {
  ImageModerationRejectedError,
  ImageModerationUnavailableError
} from "../services/image-moderation-service.js";
import {
  ClothingPresenceRejectedError,
  ClothingPresenceUnavailableError
} from "../services/gemini-clothing-presence-service.js";

function makeUserRecord(): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-abc",
    email: "test@example.com",
    name: "Test User",
    picture: null,
    profile: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function makeClosetItem(overrides: Partial<ClosetItemRecord> = {}): ClosetItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    imageUrl: "https://cdn.example.com/user-1/item-1.jpg",
    analysisStatus: "pending",
    analysisError: null,
    name: null,
    category: null,
    tags: [],
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

async function startServer(dependencies: {
  authService: AuthService;
  closetRepository: ClosetRepository;
  r2StorageService: R2StorageService;
  reviewedImageStorageService: ReviewedImageStorageService;
  geminiExtractionService: GeminiExtractionService;
  geminiRecommendationService: GeminiRecommendationService;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createClosetRoutes(dependencies));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function makeRouteHarness(options: {
  authenticated?: boolean;
  isR2Configured?: boolean;
  isGeminiConfigured?: boolean;
} = {}) {
  const authenticated = options.authenticated ?? true;
  const isR2Configured = options.isR2Configured ?? true;
  const isGeminiConfigured = options.isGeminiConfigured ?? true;
  const user = makeUserRecord();

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue(
      authenticated
        ? { user, error: null }
        : { user: null, error: { status: 401, message: "Missing bearer token." } }
    )
  } as unknown as AuthService;

  const closetRepository = {
    listByUser: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(makeClosetItem()),
    findById: vi.fn().mockResolvedValue(makeClosetItem()),
    updateExtraction: vi.fn().mockResolvedValue(makeClosetItem({ analysisStatus: "ready" })),
    updateImage: vi.fn().mockResolvedValue(makeClosetItem())
  } as unknown as ClosetRepository;

  const r2StorageService = {
    isConfigured: vi.fn().mockReturnValue(isR2Configured),
    presignClosetImageUpload: vi.fn().mockResolvedValue({
      uploadUrl: "https://r2.example.com/presigned-upload",
      publicUrl: "https://cdn.example.com/user-1/item-1.jpg"
    }),
    ownsPublicUrl: vi.fn().mockReturnValue(true),
    deleteObject: vi.fn().mockResolvedValue(undefined)
  } as unknown as R2StorageService;

  const reviewedImageStorageService = {
    isConfigured: vi.fn().mockReturnValue(isR2Configured),
    isClosetImageReviewConfigured: vi.fn().mockReturnValue(isR2Configured),
    storeUserImage: vi.fn().mockResolvedValue({
      key: "user-1/closet/test-upload.jpg",
      publicUrl: "https://cdn.example.com/user-1/item-1.jpg"
    })
  } as unknown as ReviewedImageStorageService;

  const geminiExtractionService = {
    isConfigured: vi.fn().mockReturnValue(isGeminiConfigured),
    analyzeClothingImage: vi.fn().mockResolvedValue({
      name: "Blue Shirt",
      category: "tops",
      tags: ["blue", "casual"],
      description: "A casual blue shirt"
    })
  } as unknown as GeminiExtractionService;

  const geminiRecommendationService = {} as unknown as GeminiRecommendationService;

  return {
    dependencies: {
      authService,
      closetRepository,
      r2StorageService,
      reviewedImageStorageService,
      geminiExtractionService,
      geminiRecommendationService
    },
    spies: {
      listByUser: (closetRepository as unknown as { listByUser: ReturnType<typeof vi.fn> }).listByUser,
      create: (closetRepository as unknown as { create: ReturnType<typeof vi.fn> }).create,
      findById: (closetRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      updateExtraction: (closetRepository as unknown as { updateExtraction: ReturnType<typeof vi.fn> }).updateExtraction,
      updateImage: (closetRepository as unknown as { updateImage: ReturnType<typeof vi.fn> }).updateImage,
      storeUserImage: (reviewedImageStorageService as unknown as { storeUserImage: ReturnType<typeof vi.fn> }).storeUserImage,
      deleteObject: (r2StorageService as unknown as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject,
      analyzeClothingImage: (geminiExtractionService as unknown as { analyzeClothingImage: ReturnType<typeof vi.fn> }).analyzeClothingImage
    }
  };
}

describe("createClosetRoutes", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  describe("GET /closet/items", () => {
    it("returns 200 with items array", async () => {
      const harness = makeRouteHarness();
      const items = [makeClosetItem(), makeClosetItem({ id: "item-2" })];
      harness.spies.listByUser.mockResolvedValue(items);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(Array.isArray(body.items)).toBe(true);
      expect((body.items as unknown[]).length).toBe(2);
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`);

      expect(response.status).toBe(401);
    });
  });

  describe("POST /closet/items", () => {
    it("returns 201 with item on success", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(201);
      expect(body.item).toBeDefined();
      expect(harness.spies.storeUserImage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          folder: "closet",
          contentType: "image/jpeg",
          buffer: expect.any(Buffer)
        })
      );
      expect(harness.spies.create).toHaveBeenCalledWith("user-1", "https://cdn.example.com/user-1/item-1.jpg");
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });

      expect(response.status).toBe(401);
    });

    it("returns 503 when image upload is not configured", async () => {
      const harness = makeRouteHarness({ isR2Configured: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.error).toBe("Image upload is temporarily unavailable. Please try again later.");
    });

    it("returns 400 when Content-Type header is missing", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        body: new Uint8Array([1, 2, 3])
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body.error).toBe("Invalid image content type.");
    });

    it("returns 400 for invalid contentType", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not-an-image"
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(typeof body.error).toBe("string");
      expect(body.error as string).toContain("text/plain");
    });

    it("returns 422 when moderation rejects the image", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ImageModerationRejectedError(
          "This image could not be uploaded because it appears to violate WearWise's image safety policy. Please choose a different image.",
          ["adult"],
          { adult: "VERY_LIKELY" }
        )
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(422);
      expect(typeof body.error).toBe("string");
    });

    it("does not create a closet item when moderation rejects", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ImageModerationRejectedError("Rejected", ["adult"], {})
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });

      expect(harness.spies.create).not.toHaveBeenCalled();
    });

    it("returns 503 when moderation service is unavailable", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ImageModerationUnavailableError(
          "Image review is temporarily unavailable. Please try uploading again later."
        )
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });

    it("returns 422 when Gemini rejects an upload without clothing", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ClothingPresenceRejectedError("No clothing item is visible.")
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(422);
      expect(body.error as string).toContain("no clothing item was detected");
      expect(harness.spies.create).not.toHaveBeenCalled();
    });

    it("returns 503 when Gemini clothing review is unavailable", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(new ClothingPresenceUnavailableError());
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });
  });

  describe("PUT /closet/items/:id/image", () => {
    it("returns 200 with updated item on success", async () => {
      const harness = makeRouteHarness();
      const updated = makeClosetItem({ imageUrl: "https://cdn.example.com/user-1/new-image.jpg" });
      harness.spies.updateImage.mockResolvedValue(updated);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.item).toBeDefined();
    });

    it("stores image then updates closet item image", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });

      expect(harness.spies.storeUserImage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          folder: "closet",
          contentType: "image/jpeg"
        })
      );
      expect(harness.spies.updateImage).toHaveBeenCalledWith(
        "user-1",
        "item-1",
        "https://cdn.example.com/user-1/item-1.jpg"
      );
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });

      expect(response.status).toBe(401);
    });

    it("returns 503 when image upload is not configured", async () => {
      const harness = makeRouteHarness({ isR2Configured: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.error).toBe("Image upload is temporarily unavailable. Please try again later.");
    });

    it("returns 404 when item is not found", async () => {
      const harness = makeRouteHarness();
      harness.spies.findById.mockResolvedValue(null);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/nonexistent/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(404);
      expect(body.error).toBe("Closet item not found.");
    });

    it("returns 400 for invalid image content type", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: "not-an-image"
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(typeof body.error).toBe("string");
    });

    it("returns 422 when moderation rejects the replacement image", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ImageModerationRejectedError(
          "This image could not be uploaded because it appears to violate WearWise's image safety policy. Please choose a different image.",
          ["adult"],
          { adult: "VERY_LIKELY" }
        )
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(422);
      expect(typeof body.error).toBe("string");
    });

    it("returns 503 when moderation service is unavailable", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ImageModerationUnavailableError(
          "Image review is temporarily unavailable. Please try uploading again later."
        )
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });

    it("returns 422 when Gemini rejects a replacement image without clothing", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(
        new ClothingPresenceRejectedError("No clothing item is visible.")
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(422);
      expect(body.error as string).toContain("no clothing item was detected");
      expect(harness.spies.updateImage).not.toHaveBeenCalled();
    });

    it("returns 503 when Gemini clothing review is unavailable for replacement", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserImage.mockRejectedValue(new ClothingPresenceUnavailableError());
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });

    it("cleans up uploaded image when updateImage throws", async () => {
      const harness = makeRouteHarness();
      harness.spies.updateImage.mockRejectedValue(new Error("DB write failed"));
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/image`, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("replacement-image-data")
      });

      expect(response.status).toBe(500);
      expect(harness.spies.deleteObject).toHaveBeenCalled();
    });
  });

  describe("GET /closet/items/:id", () => {
    it("returns 200 with item when found", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1`);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect((body.item as Record<string, unknown>).id).toBe("item-1");
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1`);

      expect(response.status).toBe(401);
    });

    it("returns 404 when item not found", async () => {
      const harness = makeRouteHarness();
      harness.spies.findById.mockResolvedValue(null);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/nonexistent`);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(404);
      expect(body.error).toBe("Closet item not found.");
    });
  });

  describe("POST /closet/items/:id/analyze", () => {
    it("returns 200 with analyzed item on success", async () => {
      const harness = makeRouteHarness();
      const readyItem = makeClosetItem({
        analysisStatus: "ready",
        name: "Blue Shirt",
        category: "tops",
        tags: ["blue"],
        description: "A casual blue shirt"
      });
      harness.spies.updateExtraction.mockResolvedValue(readyItem);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: "image/jpeg" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect((body.item as Record<string, unknown>).analysisStatus).toBe("ready");
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/analyze`, {
        method: "POST"
      });

      expect(response.status).toBe(401);
    });

    it("returns 503 when Gemini is not configured", async () => {
      const harness = makeRouteHarness({ isGeminiConfigured: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/analyze`, {
        method: "POST"
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.error).toBe("Gemini extraction service is not configured.");
    });

    it("returns 404 when item not found", async () => {
      const harness = makeRouteHarness();
      harness.spies.findById.mockResolvedValue(null);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/nonexistent/analyze`, {
        method: "POST"
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(404);
      expect(body.error).toBe("Closet item not found.");
    });

    it("returns 500 and saves error status when extraction fails", async () => {
      const harness = makeRouteHarness();
      harness.spies.analyzeClothingImage.mockRejectedValue(new Error("Gemini API timeout"));
      const errorItem = makeClosetItem({ analysisStatus: "error", analysisError: "Gemini API timeout" });
      harness.spies.updateExtraction.mockResolvedValue(errorItem);
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items/item-1/analyze`, {
        method: "POST"
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(body.error).toBe("Failed to analyze clothing item.");
      expect(harness.spies.updateExtraction).toHaveBeenCalledWith(
        "user-1",
        "item-1",
        expect.objectContaining({ analysisStatus: "error" })
      );
    });
  });
});
