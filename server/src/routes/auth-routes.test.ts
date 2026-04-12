import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthRoutes } from "./auth-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { GoogleOAuthService } from "../services/google-oauth-service.js";
import type { SessionService } from "../services/session-service.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { UserRecord } from "../types/domain.js";

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-abc",
    email: "test@example.com",
    name: "Test User",
    picture: "https://example.com/photo.jpg",
    profile: {
      name: "Test User",
      heightCm: 175,
      weightKg: 70,
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

async function startServer(dependencies: {
  authService: AuthService;
  googleOAuthService: GoogleOAuthService;
  sessionService: SessionService;
  userRepository: UserRepository;
  sessionTtlSeconds: number;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createAuthRoutes(dependencies));

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
  user?: UserRecord | null;
  exchangeResult?: object;
} = {}) {
  const user = options.user !== undefined ? options.user : makeUserRecord();
  const exchangeResult = options.exchangeResult ?? {
    ok: true,
    identity: {
      sub: "google-sub-abc",
      email: "test@example.com",
      name: "Test User",
      picture: null,
      emailVerified: true
    }
  };

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      user,
      error: user ? null : { status: 401, message: "Missing bearer token." }
    }),
    toPublicUser: vi.fn((u: UserRecord) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      picture: u.picture
    }))
  } as unknown as AuthService;

  const googleOAuthService = {
    exchangeCodeForIdentity: vi.fn().mockResolvedValue(exchangeResult)
  } as unknown as GoogleOAuthService;

  const sessionService = {
    createSessionToken: vi.fn().mockReturnValue("mock-access-token")
  } as unknown as SessionService;

  const userRepository = {
    upsertFromGoogleIdentity: vi.fn().mockResolvedValue(user ?? makeUserRecord())
  } as unknown as UserRepository;

  return {
    dependencies: {
      authService,
      googleOAuthService,
      sessionService,
      userRepository,
      sessionTtlSeconds: 3600
    }
  };
}

describe("createAuthRoutes", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  describe("POST /auth/google/exchange", () => {
    it("returns 200 with accessToken, user, profile, and isFirstLogin on success", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/google/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "auth-code", redirectUri: "https://app.example.com/callback" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.accessToken).toBe("mock-access-token");
      expect(body.tokenType).toBe("Bearer");
      expect(body.expiresIn).toBe(3600);
      expect(body.user).toMatchObject({ id: "user-1", email: "test@example.com" });
      expect(body.isFirstLogin).toBe(false);
    });

    it("returns isFirstLogin: true when user has no profile", async () => {
      const userWithoutProfile = makeUserRecord({ profile: null });
      const harness = makeRouteHarness({ user: userWithoutProfile });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/google/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "auth-code", redirectUri: "https://app.example.com/callback" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.isFirstLogin).toBe(true);
      expect(body.profile).toBeNull();
    });

    it("returns error status when exchange fails", async () => {
      const harness = makeRouteHarness({
        exchangeResult: {
          ok: false,
          status: 401,
          error: "Google OAuth code exchange failed.",
          providerError: "invalid_grant",
          providerDescription: "Code expired."
        }
      });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/google/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "bad-code", redirectUri: "https://app.example.com/callback" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(401);
      expect(body.error).toBe("Google OAuth code exchange failed.");
      expect(body.providerError).toBe("invalid_grant");
    });

    it("returns 400 when code or redirectUri are missing", async () => {
      const harness = makeRouteHarness({
        exchangeResult: {
          ok: false,
          status: 400,
          error: "Both code and redirectUri are required."
        }
      });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/google/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
    });

    it("returns 500 on unexpected error", async () => {
      const harness = makeRouteHarness();
      (harness.dependencies.googleOAuthService as unknown as { exchangeCodeForIdentity: ReturnType<typeof vi.fn> })
        .exchangeCodeForIdentity.mockRejectedValue(new Error("Unexpected failure"));
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/google/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "code", redirectUri: "https://app.example.com/callback" })
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(body.error).toBe("OAuth exchange failed unexpectedly.");
    });
  });

  describe("GET /auth/me", () => {
    it("returns 200 with user, profile, and isFirstLogin for authenticated user", async () => {
      const harness = makeRouteHarness();
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/me`, {
        headers: { "Authorization": "Bearer mock-access-token" }
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.user).toMatchObject({ id: "user-1" });
      expect(body.isFirstLogin).toBe(false);
    });

    it("returns isFirstLogin: true when user has no profile", async () => {
      const userWithoutProfile = makeUserRecord({ profile: null });
      const harness = makeRouteHarness({ user: userWithoutProfile });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/me`, {
        headers: { "Authorization": "Bearer mock-access-token" }
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.isFirstLogin).toBe(true);
    });

    it("returns 401 when auth resolution fails", async () => {
      const harness = makeRouteHarness({ user: null });
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/me`);

      expect(response.status).toBe(401);
    });

    it("returns 500 on unexpected error", async () => {
      const harness = makeRouteHarness();
      (harness.dependencies.authService as unknown as { resolveAuthenticatedUser: ReturnType<typeof vi.fn> })
        .resolveAuthenticatedUser.mockRejectedValue(new Error("DB down"));
      const started = await startServer(harness.dependencies);
      server = started.server;

      const response = await fetch(`${started.baseUrl}/api/auth/me`);
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(500);
      expect(body.error).toBe("Failed to read session.");
    });
  });
});
