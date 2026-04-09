import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserRepository } from "../repositories/user-repository.js";
import { createProfileRoutes } from "./profile-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { UserRecord } from "../types/domain.js";

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-1",
    email: "test@example.com",
    name: "Taylor",
    picture: null,
    profile: {
      name: "Taylor",
      heightCm: 175,
      weightKg: 68,
      styleNote: "casual",
      avatarUrl: null,
      fullBodyImageUrl: null,
      headshotImageUrl: null
    },
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

async function startServer(dependencies: {
  authService: AuthService;
  userRepository: UserRepository;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createProfileRoutes(dependencies));

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

describe("createProfileRoutes GET /profile – sex field", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("returns the sex field when it is set on the user profile", async () => {
    const userRecord = makeUserRecord({
      profile: {
        name: "Taylor",
        heightCm: 175,
        weightKg: 68,
        styleNote: "casual",
        avatarUrl: null,
        fullBodyImageUrl: null,
        headshotImageUrl: null,
        sex: "female"
      }
    });

    const authService = {
      resolveAuthenticatedUser: vi.fn().mockResolvedValue({ user: userRecord, error: null })
    } as unknown as AuthService;

    const userRepository = {
      updateProfile: vi.fn()
    } as unknown as UserRepository;

    const started = await startServer({ authService, userRepository });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/profile`);
    const body = await response.json() as { profile: { sex?: string } };

    expect(response.status).toBe(200);
    expect(body.profile.sex).toBe("female");
  });

  it("returns profile without sex field when sex is not set", async () => {
    const userRecord = makeUserRecord();

    const authService = {
      resolveAuthenticatedUser: vi.fn().mockResolvedValue({ user: userRecord, error: null })
    } as unknown as AuthService;

    const userRepository = {
      updateProfile: vi.fn()
    } as unknown as UserRepository;

    const started = await startServer({ authService, userRepository });
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/profile`);
    const body = await response.json() as { profile: { sex?: string } };

    expect(response.status).toBe(200);
    expect(body.profile.sex).toBeUndefined();
  });

  it("persists sex via POST and the subsequent GET returns it", async () => {
    let storedProfile = makeUserRecord().profile;

    const userRecord = makeUserRecord({ profile: storedProfile });

    const authService = {
      resolveAuthenticatedUser: vi.fn().mockImplementation(async () => ({
        user: { ...userRecord, profile: storedProfile },
        error: null
      }))
    } as unknown as AuthService;

    const userRepository = {
      updateProfile: vi.fn().mockImplementation(async (_id: string, profile: typeof storedProfile) => {
        storedProfile = profile;
        return { ...userRecord, profile };
      })
    } as unknown as UserRepository;

    const authServiceWithPublicUser = {
      ...authService,
      toPublicUser: vi.fn().mockReturnValue({ id: "user-1", email: "test@example.com", name: "Taylor", picture: null })
    } as unknown as AuthService;

    const started = await startServer({ authService: authServiceWithPublicUser, userRepository });
    server = started.server;

    // POST to save profile with sex = "male"
    const postResponse = await fetch(`${started.baseUrl}/api/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Taylor",
        heightCm: 175,
        weightKg: 68,
        styleNote: "casual",
        sex: "male"
      })
    });
    expect(postResponse.status).toBe(200);

    // GET should now return sex = "male"
    const getResponse = await fetch(`${started.baseUrl}/api/profile`);
    const body = await getResponse.json() as { profile: { sex?: string } };

    expect(getResponse.status).toBe(200);
    expect(body.profile.sex).toBe("male");
  });
});
