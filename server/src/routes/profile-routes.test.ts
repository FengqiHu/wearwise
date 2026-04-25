import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserRepository } from "../repositories/user-repository.js";
import { createProfileRoutes } from "./profile-routes.js";
import type { AuthService } from "../services/auth-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { UserProfile, UserRecord } from "../types/domain.js";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: "Taylor",
    heightCm: 180,
    weightKg: 75,
    styleNote: "minimal streetwear",
    avatarUrl: "https://cdn.example.com/user-1/avatar/original.png",
    fullBodyImageUrl: "https://cdn.example.com/user-1/full-body/original.png",
    headshotImageUrl: "https://cdn.example.com/user-1/headshot/original.png",
    ...overrides
  };
}

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    googleSub: "google-sub-1",
    email: "test@example.com",
    name: "Taylor",
    picture: null,
    profile: makeProfile(),
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

async function startServer(dependencies: {
  authService: AuthService;
  userRepository: UserRepository;
  r2StorageService: R2StorageService;
}): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.use("/api", createProfileRoutes(dependencies));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server
  };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function postProfile(baseUrl: string, payload: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function makeRouteHarness(options: {
  currentUser?: UserRecord;
  updatedUser?: UserRecord | null;
  isR2Configured?: boolean;
} = {}) {
  const currentUser = options.currentUser ?? makeUserRecord();
  const updatedUser = "updatedUser" in options ? options.updatedUser ?? null : currentUser;
  const isR2Configured = options.isR2Configured ?? true;

  const authService = {
    resolveAuthenticatedUser: vi.fn().mockResolvedValue({
      user: currentUser,
      error: null
    }),
    toPublicUser: vi.fn((user: UserRecord) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture
    }))
  } as unknown as AuthService;

  const userRepository = {
    updateProfile: vi.fn().mockResolvedValue(updatedUser)
  } as unknown as UserRepository;

  const r2StorageService = {
    isConfigured: vi.fn().mockReturnValue(isR2Configured),
    ownsPublicUrl: vi.fn((publicUrl: string) => publicUrl.startsWith("https://cdn.example.com/")),
    deleteObject: vi.fn().mockResolvedValue(undefined)
  } as unknown as R2StorageService;

  return {
    dependencies: {
      authService,
      userRepository,
      r2StorageService
    },
    spies: {
      resolveAuthenticatedUser: (authService as unknown as { resolveAuthenticatedUser: ReturnType<typeof vi.fn> }).resolveAuthenticatedUser,
      toPublicUser: (authService as unknown as { toPublicUser: ReturnType<typeof vi.fn> }).toPublicUser,
      updateProfile: (userRepository as unknown as { updateProfile: ReturnType<typeof vi.fn> }).updateProfile,
      isConfigured: (r2StorageService as unknown as { isConfigured: ReturnType<typeof vi.fn> }).isConfigured,
      ownsPublicUrl: (r2StorageService as unknown as { ownsPublicUrl: ReturnType<typeof vi.fn> }).ownsPublicUrl,
      deleteObject: (r2StorageService as unknown as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject
    }
  };
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
    const harness = makeRouteHarness({
      currentUser: makeUserRecord({ profile: makeProfile({ sex: "female" }) })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/profile`);
    const body = await response.json() as { profile: { sex?: string } };

    expect(response.status).toBe(200);
    expect(body.profile.sex).toBe("female");
  });

  it("returns profile without sex field when sex is not set", async () => {
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/api/profile`);
    const body = await response.json() as { profile: { sex?: string } };

    expect(response.status).toBe(200);
    expect(body.profile.sex).toBeUndefined();
  });

  it("persists sex via POST and the subsequent GET returns it", async () => {
    let storedProfile = makeProfile();

    const authService = {
      resolveAuthenticatedUser: vi.fn().mockImplementation(async () => ({
        user: { ...makeUserRecord(), profile: storedProfile },
        error: null
      })),
      toPublicUser: vi.fn().mockReturnValue({ id: "user-1", email: "test@example.com", name: "Taylor", picture: null })
    } as unknown as AuthService;

    const userRepository = {
      updateProfile: vi.fn().mockImplementation(async (_id: string, profile: UserProfile) => {
        storedProfile = profile;
        return { ...makeUserRecord(), profile };
      })
    } as unknown as UserRepository;

    const r2StorageService = {
      isConfigured: vi.fn().mockReturnValue(false),
      ownsPublicUrl: vi.fn().mockReturnValue(false),
      deleteObject: vi.fn().mockResolvedValue(undefined)
    } as unknown as R2StorageService;

    const started = await startServer({ authService, userRepository, r2StorageService });
    server = started.server;

    const postResponse = await postProfile(started.baseUrl, {
      name: "Taylor",
      heightCm: 175,
      weightKg: 68,
      styleNote: "casual",
      sex: "male"
    });
    expect(postResponse.status).toBe(200);

    const getResponse = await fetch(`${started.baseUrl}/api/profile`);
    const body = await getResponse.json() as { profile: { sex?: string } };

    expect(getResponse.status).toBe(200);
    expect(body.profile.sex).toBe("male");
  });
});

describe("createProfileRoutes POST /profile", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
  });

  it("deletes removed optional managed profile images after the profile update succeeds", async () => {
    const currentUser = makeUserRecord();
    const updatedProfile = makeProfile({
      avatarUrl: null,
      fullBodyImageUrl: currentUser.profile?.fullBodyImageUrl ?? null,
      headshotImageUrl: null
    });
    const harness = makeRouteHarness({
      currentUser,
      updatedUser: makeUserRecord({ profile: updatedProfile })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, {
      name: updatedProfile.name,
      heightCm: updatedProfile.heightCm,
      weightKg: updatedProfile.weightKg,
      styleNote: updatedProfile.styleNote,
      avatarUrl: "",
      fullBodyImageUrl: updatedProfile.fullBodyImageUrl,
      headshotImageUrl: ""
    });

    expect(response.status).toBe(200);
    expect(harness.spies.updateProfile).toHaveBeenCalledWith("user-1", updatedProfile);
    expect(harness.spies.deleteObject).toHaveBeenCalledTimes(2);
    expect(harness.spies.deleteObject).toHaveBeenCalledWith("https://cdn.example.com/user-1/avatar/original.png");
    expect(harness.spies.deleteObject).toHaveBeenCalledWith("https://cdn.example.com/user-1/headshot/original.png");
  });

  it("deletes replaced managed profile images after a successful save", async () => {
    const currentUser = makeUserRecord({
      profile: makeProfile({
        avatarUrl: "https://cdn.example.com/user-1/avatar/original.png",
        fullBodyImageUrl: "https://cdn.example.com/user-1/full-body/original.png",
        headshotImageUrl: "https://cdn.example.com/user-1/headshot/original.png"
      })
    });
    const nextProfile = makeProfile({
      avatarUrl: "https://cdn.example.com/user-1/avatar/replacement.png",
      fullBodyImageUrl: currentUser.profile?.fullBodyImageUrl ?? null,
      headshotImageUrl: currentUser.profile?.headshotImageUrl ?? null
    });
    const harness = makeRouteHarness({
      currentUser,
      updatedUser: makeUserRecord({ profile: nextProfile })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, nextProfile);

    expect(response.status).toBe(200);
    expect(harness.spies.updateProfile).toHaveBeenCalledWith("user-1", nextProfile);
    expect(harness.spies.deleteObject).toHaveBeenCalledTimes(1);
    expect(harness.spies.deleteObject).toHaveBeenCalledWith("https://cdn.example.com/user-1/avatar/original.png");
    expect(harness.spies.toPublicUser).toHaveBeenCalledOnce();
  });

  it("rejects external profile image URLs before saving", async () => {
    const nextProfile = makeProfile({
      avatarUrl: "https://images.example.org/avatar.png"
    });
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, nextProfile);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.error).toBe("Profile images must be uploaded through WearWise before saving.");
    expect(harness.spies.updateProfile).not.toHaveBeenCalled();
  });

  it("rejects profile image URLs owned by another user before saving", async () => {
    const nextProfile = makeProfile({
      fullBodyImageUrl: "https://cdn.example.com/user-2/full-body/body.png"
    });
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, nextProfile);

    expect(response.status).toBe(400);
    expect(harness.spies.updateProfile).not.toHaveBeenCalled();
  });

  it("rejects profile image URLs from the wrong managed folder before saving", async () => {
    const nextProfile = makeProfile({
      avatarUrl: "https://cdn.example.com/user-1/closet/shirt.png"
    });
    const harness = makeRouteHarness();
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, nextProfile);

    expect(response.status).toBe(400);
    expect(harness.spies.updateProfile).not.toHaveBeenCalled();
  });

  it("does not delete the active image when the profile update fails", async () => {
    const currentUser = makeUserRecord();
    const nextProfile = makeProfile({
      avatarUrl: "https://cdn.example.com/user-1/avatar/replacement.png"
    });
    const harness = makeRouteHarness({
      currentUser,
      updatedUser: null
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, nextProfile);

    expect(response.status).toBe(404);
    expect(harness.spies.updateProfile).toHaveBeenCalledWith("user-1", nextProfile);
    expect(harness.spies.deleteObject).not.toHaveBeenCalled();
  });

  it("deletes all removed managed URLs while leaving unchanged or external URLs alone", async () => {
    const currentUser = makeUserRecord({
      profile: makeProfile({
        avatarUrl: "https://cdn.example.com/user-1/avatar/original.png",
        fullBodyImageUrl: "https://cdn.example.com/user-1/full-body/original.png",
        headshotImageUrl: "https://images.example.org/headshot.png"
      })
    });
    const nextProfile = makeProfile({
      avatarUrl: null,
      fullBodyImageUrl: "https://cdn.example.com/user-1/full-body/original.png",
      headshotImageUrl: null
    });
    const harness = makeRouteHarness({
      currentUser,
      updatedUser: makeUserRecord({ profile: nextProfile })
    });
    const started = await startServer(harness.dependencies);
    server = started.server;

    const response = await postProfile(started.baseUrl, {
      name: nextProfile.name,
      heightCm: nextProfile.heightCm,
      weightKg: nextProfile.weightKg,
      styleNote: nextProfile.styleNote,
      avatarUrl: "",
      fullBodyImageUrl: nextProfile.fullBodyImageUrl,
      headshotImageUrl: ""
    });

    expect(response.status).toBe(200);
    expect(harness.spies.deleteObject).toHaveBeenCalledTimes(1);
    expect(harness.spies.deleteObject).toHaveBeenCalledWith("https://cdn.example.com/user-1/avatar/original.png");
    expect(harness.spies.ownsPublicUrl).toHaveBeenCalledWith("https://cdn.example.com/user-1/avatar/original.png");
    expect(harness.spies.ownsPublicUrl).toHaveBeenCalledWith("https://images.example.org/headshot.png");
  });
});
