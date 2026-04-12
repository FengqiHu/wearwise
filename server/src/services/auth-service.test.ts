import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { AuthService } from "./auth-service.js";
import type { SessionService } from "./session-service.js";
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

function makeRequest(authorization?: string): Request {
  return {
    header: vi.fn((name: string) => {
      if (name.toLowerCase() === "authorization") {
        return authorization;
      }
      return undefined;
    })
  } as unknown as Request;
}

function makeSessionService(overrides: Partial<SessionService> = {}) {
  return {
    readBearerToken: vi.fn().mockReturnValue(null),
    verifySessionToken: vi.fn().mockReturnValue(null),
    createSessionToken: vi.fn().mockReturnValue("token"),
    ...overrides
  } as unknown as SessionService;
}

function makeUserRepository(overrides: Partial<UserRepository> = {}) {
  return {
    findById: vi.fn().mockResolvedValue(null),
    ...overrides
  } as unknown as UserRepository;
}

describe("AuthService", () => {
  describe("resolveAuthenticatedUser", () => {
    it("returns 401 error when bearer token is missing", async () => {
      const sessionService = makeSessionService({
        readBearerToken: vi.fn().mockReturnValue(null)
      } as unknown as Partial<SessionService>);
      const userRepository = makeUserRepository();
      const authService = new AuthService(sessionService, userRepository);

      const result = await authService.resolveAuthenticatedUser(makeRequest());

      expect(result.user).toBeNull();
      expect(result.error).toEqual({
        status: 401,
        message: "Missing bearer token."
      });
    });

    it("returns 401 error when token verification fails", async () => {
      const sessionService = makeSessionService({
        readBearerToken: vi.fn().mockReturnValue("bad-token"),
        verifySessionToken: vi.fn().mockReturnValue(null)
      } as unknown as Partial<SessionService>);
      const userRepository = makeUserRepository();
      const authService = new AuthService(sessionService, userRepository);

      const result = await authService.resolveAuthenticatedUser(makeRequest("Bearer bad-token"));

      expect(result.user).toBeNull();
      expect(result.error).toEqual({
        status: 401,
        message: "Invalid or expired token."
      });
    });

    it("returns 401 error when user is not found in database", async () => {
      const sessionService = makeSessionService({
        readBearerToken: vi.fn().mockReturnValue("valid-token"),
        verifySessionToken: vi.fn().mockReturnValue({
          userId: "nonexistent-user",
          iat: 1000,
          exp: 9999999999
        })
      } as unknown as Partial<SessionService>);
      const userRepository = makeUserRepository({
        findById: vi.fn().mockResolvedValue(null)
      } as unknown as Partial<UserRepository>);
      const authService = new AuthService(sessionService, userRepository);

      const result = await authService.resolveAuthenticatedUser(makeRequest("Bearer valid-token"));

      expect(result.user).toBeNull();
      expect(result.error).toEqual({
        status: 401,
        message: "User for this session was not found."
      });
    });

    it("returns user record when token is valid and user exists", async () => {
      const user = makeUserRecord();
      const sessionService = makeSessionService({
        readBearerToken: vi.fn().mockReturnValue("valid-token"),
        verifySessionToken: vi.fn().mockReturnValue({
          userId: "user-1",
          iat: 1000,
          exp: 9999999999
        })
      } as unknown as Partial<SessionService>);
      const userRepository = makeUserRepository({
        findById: vi.fn().mockResolvedValue(user)
      } as unknown as Partial<UserRepository>);
      const authService = new AuthService(sessionService, userRepository);

      const result = await authService.resolveAuthenticatedUser(makeRequest("Bearer valid-token"));

      expect(result.error).toBeNull();
      expect(result.user).toEqual(user);
    });
  });

  describe("toPublicUser", () => {
    it("returns only id, email, name, and picture", () => {
      const sessionService = makeSessionService();
      const userRepository = makeUserRepository();
      const authService = new AuthService(sessionService, userRepository);

      const user = makeUserRecord();
      const publicUser = authService.toPublicUser(user);

      expect(publicUser).toEqual({
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
        picture: "https://example.com/photo.jpg"
      });
    });

    it("does not expose sensitive fields", () => {
      const sessionService = makeSessionService();
      const userRepository = makeUserRepository();
      const authService = new AuthService(sessionService, userRepository);

      const user = makeUserRecord();
      const publicUser = authService.toPublicUser(user);

      const keys = Object.keys(publicUser);
      expect(keys).not.toContain("googleSub");
      expect(keys).not.toContain("profile");
      expect(keys).not.toContain("createdAt");
      expect(keys).not.toContain("updatedAt");
    });
  });
});
