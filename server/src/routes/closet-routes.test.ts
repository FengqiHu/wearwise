import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClosetRoutes } from "./closet-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import type { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { ClosetItemRecord, UserRecord } from "../types/domain.js";

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
    updateExtraction: vi.fn().mockResolvedValue(makeClosetItem({ analysisStatus: "ready" }))
  } as unknown as ClosetRepository;

  const r2StorageService = {
    isConfigured: vi.fn().mockReturnValue(isR2Configured),
    presignClosetImageUpload: vi.fn().mockResolvedValue({
      uploadUrl: "https://r2.example.com/presigned-upload",
      publicUrl: "https://cdn.example.com/user-1/item-1.jpg"
    })
  } as unknown as R2StorageService;

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
      geminiExtractionService,
      geminiRecommendationService
    },
    spies: {
      listByUser: (closetRepository as unknown as { listByUser: ReturnType<typeof vi.fn> }).listByUser,
      create: (closetRepository as unknown as { create: ReturnType<typeof vi.fn> }).create,
      findById: (closetRepository as unknown as { findById: ReturnType<typeof vi.fn> }).findById,
      updateExtraction: (closetRepository as unknown as { updateExtraction: ReturnType<typeof vi.fn> }).updateExtraction,
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
    it("returns 201 with item and uploadUrl on success", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "image/jpeg" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(201);
      expect(body.item).toBeDefined();
      expect(body.uploadUrl).toBe("https://r2.example.com/presigned-upload");
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "image/jpeg" })
      });

      expect(response.status).toBe(401);
    });

    it("returns 503 when R2 storage is not configured", async () => {
      const harness = makeRouteHarness({ isR2Configured: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "image/jpeg" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.error).toBe("Storage service is not configured.");
    });

    it("returns 400 when contentType is missing", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body.error).toBe("Missing required field: contentType.");
    });

    it("returns 400 for invalid contentType", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/closet/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "text/plain" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(typeof body.error).toBe("string");
      expect(body.error as string).toContain("text/plain");
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
