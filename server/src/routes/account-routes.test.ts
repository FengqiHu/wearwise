import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountRoutes } from "./account-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { GenerationRepository } from "../repositories/generation-repository.js";
import type { AccountDeletionRepository } from "../repositories/account-deletion-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type {
  ClosetItemRecord,
  GenerationRecord,
  RecommendationRecord,
  UserRecord
} from "../types/domain.js";

const CDN_BASE = "https://cdn.example.com";

function cdnUrl(path: string): string {
  return `${CDN_BASE}/${path}`;
}

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-abc",
    email: "test@example.com",
    name: "Test User",
    picture: null,
    profile: {
      name: "Test User",
      heightCm: 170,
      weightKg: 65,
      styleNote: "",
      avatarUrl: null,
      fullBodyImageUrl: null,
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
    imageUrl: cdnUrl("user-1/closet/item-1.jpg"),
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

function makeRecommendationRecord(overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    id: "rec-1",
    userId: "user-1",
    outfitName: "Casual Look",
    reason: "Comfortable for daily wear.",
    items: [],
    occasions: [],
    weather: null,
    generation: null,
    vote: null,
    conversationId: "conv-1",
    messageId: "msg-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeGenerationRecord(overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    id: "gen-1",
    userId: "user-1",
    clothingItemIds: ["item-1"],
    generatedImageUrl: cdnUrl("user-1/generated/outfit-1.jpg"),
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

async function startServer(dependencies: {
  authService: AuthService;
  userRepository: UserRepository;
  closetRepository: ClosetRepository;
  conversationRepository: ConversationRepository;
  recommendationRepository: RecommendationRepository;
  generationRepository: GenerationRepository;
  accountDeletionRepository: AccountDeletionRepository;
  r2StorageService: R2StorageService;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createAccountRoutes(dependencies));

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

function makeRouteHarness(
  options: {
    authenticated?: boolean;
    user?: UserRecord;
    r2Configured?: boolean;
    closetItems?: ClosetItemRecord[];
    recommendations?: RecommendationRecord[];
    generations?: GenerationRecord[];
  } = {}
) {
  const authenticated = options.authenticated ?? true;
  const user = options.user ?? makeUserRecord();
  const r2Configured = options.r2Configured ?? true;

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue(
      authenticated
        ? { user, error: null }
        : { user: null, error: { status: 401, message: "Missing bearer token." } }
    )
  } as unknown as AuthService;

  const userRepository = {} as unknown as UserRepository;
  const conversationRepository = {} as unknown as ConversationRepository;

  const closetRepository = {
    listAllByUser: vi.fn().mockResolvedValue(options.closetItems ?? [])
  } as unknown as ClosetRepository;

  const recommendationRepository = {
    listAllByUser: vi.fn().mockResolvedValue(options.recommendations ?? [])
  } as unknown as RecommendationRepository;

  const generationRepository = {
    listAllByUser: vi.fn().mockResolvedValue(options.generations ?? [])
  } as unknown as GenerationRepository;

  const accountDeletionRepository = {
    deleteUserData: vi.fn().mockResolvedValue(undefined)
  } as unknown as AccountDeletionRepository;

  const r2StorageService = {
    isConfigured: vi.fn().mockReturnValue(r2Configured),
    ownsPublicUrl: vi.fn((url: string) => url.startsWith(`${CDN_BASE}/`)),
    deleteObject: vi.fn().mockResolvedValue(undefined)
  } as unknown as R2StorageService;

  return {
    dependencies: {
      authService,
      userRepository,
      closetRepository,
      conversationRepository,
      recommendationRepository,
      generationRepository,
      accountDeletionRepository,
      r2StorageService
    },
    spies: {
      deleteUserData: (accountDeletionRepository as unknown as { deleteUserData: ReturnType<typeof vi.fn> }).deleteUserData,
      deleteObject: (r2StorageService as unknown as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject,
      listAllByUserCloset: (closetRepository as unknown as { listAllByUser: ReturnType<typeof vi.fn> }).listAllByUser,
      listAllByUserRecommendations: (recommendationRepository as unknown as { listAllByUser: ReturnType<typeof vi.fn> }).listAllByUser,
      listAllByUserGenerations: (generationRepository as unknown as { listAllByUser: ReturnType<typeof vi.fn> }).listAllByUser
    }
  };
}

describe("createAccountRoutes", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  describe("DELETE /account", () => {
    it("returns 204 on success", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

      expect(response.status).toBe(204);
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

      expect(response.status).toBe(401);
    });

    it("calls deleteUserData with the authenticated user's id", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

      expect(harness.spies.deleteUserData).toHaveBeenCalledWith("user-1");
    });

    it("returns 500 when deleteUserData throws", async () => {
      const harness = makeRouteHarness();
      harness.spies.deleteUserData.mockRejectedValue(new Error("DB transaction failed"));
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(typeof body.error).toBe("string");
    });

    describe("R2 image cleanup", () => {
      it("deletes managed profile avatar, headshot, and fullBody image URLs", async () => {
        const avatarUrl = cdnUrl("user-1/avatar/photo.jpg");
        const headshotUrl = cdnUrl("user-1/headshot/photo.jpg");
        const fullBodyUrl = cdnUrl("user-1/full-body/photo.jpg");
        const user = makeUserRecord({
          profile: {
            name: "Test User",
            heightCm: 170,
            weightKg: 65,
            styleNote: "",
            avatarUrl,
            headshotImageUrl: headshotUrl,
            fullBodyImageUrl: fullBodyUrl
          }
        });
        const harness = makeRouteHarness({ user });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).toHaveBeenCalledWith(avatarUrl);
        expect(harness.spies.deleteObject).toHaveBeenCalledWith(headshotUrl);
        expect(harness.spies.deleteObject).toHaveBeenCalledWith(fullBodyUrl);
      });

      it("does not delete profile image URLs not owned by R2", async () => {
        const externalUrl = "https://external.example.com/photo.jpg";
        const user = makeUserRecord({
          profile: {
            name: "Test User",
            heightCm: 170,
            weightKg: 65,
            styleNote: "",
            avatarUrl: externalUrl,
            headshotImageUrl: null,
            fullBodyImageUrl: null
          }
        });
        const harness = makeRouteHarness({ user });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).not.toHaveBeenCalledWith(externalUrl);
      });

      it("does not attempt profile image cleanup when profile is null", async () => {
        const user = makeUserRecord({ profile: null });
        const harness = makeRouteHarness({ user });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).not.toHaveBeenCalled();
      });

      it("deletes managed closet item image URLs", async () => {
        const itemImageUrl = cdnUrl("user-1/closet/shirt.jpg");
        const harness = makeRouteHarness({
          closetItems: [makeClosetItem({ imageUrl: itemImageUrl })]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).toHaveBeenCalledWith(itemImageUrl);
      });

      it("does not delete closet item URLs not owned by R2", async () => {
        const externalUrl = "https://external.example.com/shirt.jpg";
        const harness = makeRouteHarness({
          closetItems: [makeClosetItem({ imageUrl: externalUrl })]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).not.toHaveBeenCalledWith(externalUrl);
      });

      it("deletes managed recommendation generation image URLs", async () => {
        const genImageUrl = cdnUrl("user-1/recommendations/outfit-1.jpg");
        const harness = makeRouteHarness({
          recommendations: [
            makeRecommendationRecord({
              generation: { imageUrl: genImageUrl, createdAt: "2026-01-01T00:00:00.000Z" }
            })
          ]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).toHaveBeenCalledWith(genImageUrl);
      });

      it("skips recommendations with no generation", async () => {
        const harness = makeRouteHarness({
          recommendations: [makeRecommendationRecord({ generation: null })]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).not.toHaveBeenCalled();
      });

      it("deletes managed generation image URLs", async () => {
        const generatedUrl = cdnUrl("user-1/generated/outfit-1.jpg");
        const harness = makeRouteHarness({
          generations: [makeGenerationRecord({ generatedImageUrl: generatedUrl })]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).toHaveBeenCalledWith(generatedUrl);
      });

      it("does not delete duplicate image URLs more than once", async () => {
        const sharedUrl = cdnUrl("user-1/closet/shirt.jpg");
        const harness = makeRouteHarness({
          closetItems: [
            makeClosetItem({ id: "item-1", imageUrl: sharedUrl }),
            makeClosetItem({ id: "item-2", imageUrl: sharedUrl })
          ]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        const calls = harness.spies.deleteObject.mock.calls as string[][];
        const deleteCallsForUrl = calls.filter(([url]) => url === sharedUrl);
        expect(deleteCallsForUrl).toHaveLength(1);
      });

      it("deletes all images across all data sources", async () => {
        const avatarUrl = cdnUrl("user-1/avatar/photo.jpg");
        const closetUrl = cdnUrl("user-1/closet/shirt.jpg");
        const genUrl = cdnUrl("user-1/generated/outfit.jpg");
        const user = makeUserRecord({
          profile: {
            name: "Test User",
            heightCm: 170,
            weightKg: 65,
            styleNote: "",
            avatarUrl,
            headshotImageUrl: null,
            fullBodyImageUrl: null
          }
        });
        const harness = makeRouteHarness({
          user,
          closetItems: [makeClosetItem({ imageUrl: closetUrl })],
          generations: [makeGenerationRecord({ generatedImageUrl: genUrl })]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).toHaveBeenCalledWith(avatarUrl);
        expect(harness.spies.deleteObject).toHaveBeenCalledWith(closetUrl);
        expect(harness.spies.deleteObject).toHaveBeenCalledWith(genUrl);
      });

      it("skips R2 cleanup entirely when R2 is not configured", async () => {
        const harness = makeRouteHarness({
          r2Configured: false,
          closetItems: [makeClosetItem()],
          generations: [makeGenerationRecord()]
        });
        const started = await startServer(harness.dependencies);
        server = started.server;

        const response = await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(response.status).toBe(204);
        expect(harness.spies.deleteObject).not.toHaveBeenCalled();
      });

      it("does not call deleteObject when user has no managed images", async () => {
        const harness = makeRouteHarness();
        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(harness.spies.deleteObject).not.toHaveBeenCalled();
      });

      it("still returns 204 when some R2 deletions fail", async () => {
        const harness = makeRouteHarness({
          closetItems: [makeClosetItem()]
        });
        harness.spies.deleteObject.mockRejectedValue(new Error("R2 unavailable"));
        const started = await startServer(harness.dependencies);
        server = started.server;

        const response = await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(response.status).toBe(204);
      });
    });

    describe("operation ordering", () => {
      it("calls deleteUserData before deleting R2 images", async () => {
        const callOrder: string[] = [];
        const closetUrl = cdnUrl("user-1/closet/shirt.jpg");
        const harness = makeRouteHarness({ closetItems: [makeClosetItem({ imageUrl: closetUrl })] });

        harness.spies.deleteUserData.mockImplementation(async () => {
          callOrder.push("deleteUserData");
        });
        harness.spies.deleteObject.mockImplementation(async () => {
          callOrder.push("deleteObject");
        });

        const started = await startServer(harness.dependencies);
        server = started.server;

        await fetch(`${started.baseUrl}/api/account`, { method: "DELETE" });

        expect(callOrder[0]).toBe("deleteUserData");
        expect(callOrder).toContain("deleteObject");
      });
    });
  });
});
