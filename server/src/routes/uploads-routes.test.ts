import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUploadsRoutes } from "./uploads-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { ReviewedImageStorageService } from "../services/reviewed-image-storage-service.js";
import {
  ImageModerationRejectedError,
  ImageModerationUnavailableError
} from "../services/image-moderation-service.js";
import {
  HumanPresenceRejectedError,
  HumanPresenceUnavailableError
} from "../services/gemini-human-presence-service.js";
import type { UserRecord } from "../types/domain.js";

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

async function startServer(dependencies: {
  authService: AuthService;
  reviewedImageStorageService: ReviewedImageStorageService;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use("/api", createUploadsRoutes(dependencies));

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
    isConfigured?: boolean;
  } = {}
) {
  const authenticated = options.authenticated ?? true;
  const isConfigured = options.isConfigured ?? true;
  const user = makeUserRecord();

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue(
      authenticated
        ? { user, error: null }
        : { user: null, error: { status: 401, message: "Missing bearer token." } }
    )
  } as unknown as AuthService;

  const reviewedImageStorageService = {
    isProfileImageReviewConfigured: vi.fn().mockReturnValue(isConfigured),
    storeUserProfileImage: vi.fn().mockResolvedValue({
      key: "user-1/avatar/uuid-photo.jpg",
      publicUrl: "https://cdn.example.com/user-1/avatar/uuid-photo.jpg"
    })
  } as unknown as ReviewedImageStorageService;

  return {
    dependencies: { authService, reviewedImageStorageService },
    spies: {
      storeUserProfileImage: (
        reviewedImageStorageService as unknown as {
          storeUserProfileImage: ReturnType<typeof vi.fn>;
        }
      ).storeUserProfileImage
    }
  };
}

describe("createUploadsRoutes", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  describe("POST /uploads/images", () => {
    it("returns 201 with key and publicUrl on success", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(201);
      expect(body.key).toBe("user-1/avatar/uuid-photo.jpg");
      expect(body.publicUrl).toBe("https://cdn.example.com/user-1/avatar/uuid-photo.jpg");
    });

    it("passes userId, folder, and contentType to storeUserProfileImage", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      await fetch(`${started.baseUrl}/api/uploads/images?folder=headshot`, {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: Buffer.from("test-image-data")
      });

      expect(harness.spies.storeUserProfileImage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          folder: "headshot",
          contentType: "image/png"
        })
      );
    });

    it("strips charset from content-type before passing to storeUserProfileImage", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg; charset=utf-8" },
        body: Buffer.from("test-image-data")
      });

      expect(response.status).toBe(201);
      expect(harness.spies.storeUserProfileImage).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: "image/jpeg" })
      );
    });

    it("returns 503 when storage service is not configured", async () => {
      const harness = makeRouteHarness({ isConfigured: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });

    it("returns 401 when not authenticated", async () => {
      const harness = makeRouteHarness({ authenticated: false });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });

      expect(response.status).toBe(401);
    });

    it("returns 400 for non-image content type", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(typeof body.error).toBe("string");
    });

    it("returns 400 for invalid folder value", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=unknown`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(typeof body.error).toBe("string");
    });

    it("returns 400 when folder is 'closet'", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=closet`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body.error as string).toContain("Allowed: avatar, headshot, full-body");
    });

    it("returns 400 when body is empty", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" }
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(typeof body.error).toBe("string");
    });

    it("returns 422 when moderation rejects the image", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserProfileImage.mockRejectedValue(
        new ImageModerationRejectedError(
          "This image could not be uploaded because it appears to violate WearWise's image safety policy. Please choose a different image.",
          ["adult"],
          { adult: "VERY_LIKELY" }
        )
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(422);
      expect(typeof body.error).toBe("string");
    });

    it("returns 503 when moderation service is unavailable", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserProfileImage.mockRejectedValue(
        new ImageModerationUnavailableError(
          "Image review is temporarily unavailable. Please try uploading again later."
        )
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });

    it("returns 422 when Gemini rejects an image without a real person", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserProfileImage.mockRejectedValue(
        new HumanPresenceRejectedError("No real human person is visible.")
      );
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=headshot`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(422);
      expect(body.error as string).toContain("no real person was detected");
    });

    it("returns 503 when Gemini human-presence review is unavailable", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserProfileImage.mockRejectedValue(new HumanPresenceUnavailableError());
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=full-body`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(typeof body.error).toBe("string");
    });

    it("returns 500 for unexpected errors", async () => {
      const harness = makeRouteHarness();
      harness.spies.storeUserProfileImage.mockRejectedValue(new Error("Unexpected storage failure"));
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/uploads/images?folder=avatar`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test-image-data")
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(typeof body.error).toBe("string");
    });
  });
});
