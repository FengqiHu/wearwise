import { describe, expect, it, vi, afterEach } from "vitest";
import type { Request } from "express";
import { SessionService } from "./session-service.js";

const SECRET = "test-secret-key";
const TTL_SECONDS = 3600;

function makeService(secret = SECRET, ttl = TTL_SECONDS) {
  return new SessionService(secret, ttl);
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

describe("SessionService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createSessionToken", () => {
    it("returns a string with two dot-separated parts", () => {
      const service = makeService();
      const token = service.createSessionToken("user-1");

      const parts = token.split(".");
      expect(parts).toHaveLength(2);
      expect(parts[0]!.length).toBeGreaterThan(0);
      expect(parts[1]!.length).toBeGreaterThan(0);
    });

    it("encodes userId, iat, and exp in the base64url payload", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));

      const service = makeService();
      const token = service.createSessionToken("user-42");

      const [encodedPayload] = token.split(".");
      const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));

      expect(payload.userId).toBe("user-42");
      expect(typeof payload.iat).toBe("number");
      expect(typeof payload.exp).toBe("number");
    });

    it("sets exp to iat + ttlSeconds", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));

      const ttl = 7200;
      const service = makeService(SECRET, ttl);
      const token = service.createSessionToken("user-1");

      const [encodedPayload] = token.split(".");
      const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));

      expect(payload.exp - payload.iat).toBe(ttl);
    });

    it("produces different tokens for different userIds", () => {
      const service = makeService();
      const tokenA = service.createSessionToken("user-a");
      const tokenB = service.createSessionToken("user-b");

      expect(tokenA).not.toBe(tokenB);
    });
  });

  describe("verifySessionToken", () => {
    it("returns a valid SessionPayload for a freshly created token", () => {
      const service = makeService();
      const token = service.createSessionToken("user-1");

      const payload = service.verifySessionToken(token);

      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe("user-1");
      expect(typeof payload!.iat).toBe("number");
      expect(typeof payload!.exp).toBe("number");
    });

    it("returns null for a token signed with a different secret", () => {
      const serviceA = makeService("secret-a");
      const serviceB = makeService("secret-b");

      const token = serviceA.createSessionToken("user-1");
      const payload = serviceB.verifySessionToken(token);

      expect(payload).toBeNull();
    });

    it("returns null for a malformed token without a dot separator", () => {
      const service = makeService();
      expect(service.verifySessionToken("nodothere")).toBeNull();
    });

    it("returns null for a token with empty payload", () => {
      const service = makeService();
      expect(service.verifySessionToken(".somesignature")).toBeNull();
    });

    it("returns null for a token with empty signature", () => {
      const service = makeService();
      expect(service.verifySessionToken("somepayload.")).toBeNull();
    });

    it("returns null for an expired token", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      const service = makeService(SECRET, 60);
      const token = service.createSessionToken("user-1");

      // Advance time past expiry
      vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));

      expect(service.verifySessionToken(token)).toBeNull();
    });

    it("returns null when the payload is not valid JSON", () => {
      const service = makeService();
      const badPayload = Buffer.from("not json").toString("base64url");
      const fakeToken = `${badPayload}.fakesignature`;

      expect(service.verifySessionToken(fakeToken)).toBeNull();
    });

    it("returns null when payload is missing required fields", () => {
      const service = makeService();
      // Create a token-like string with a valid JSON payload but missing userId
      const incompletePayload = Buffer.from(JSON.stringify({ iat: 100, exp: 999999999999 })).toString("base64url");
      const fakeToken = `${incompletePayload}.fakesignature`;

      expect(service.verifySessionToken(fakeToken)).toBeNull();
    });
  });

  describe("readBearerToken", () => {
    it("extracts token from a valid Bearer authorization header", () => {
      const service = makeService();
      const req = makeRequest("Bearer my-token-123");

      expect(service.readBearerToken(req)).toBe("my-token-123");
    });

    it("is case-insensitive for the Bearer scheme", () => {
      const service = makeService();
      const req = makeRequest("bearer my-token-123");

      expect(service.readBearerToken(req)).toBe("my-token-123");
    });

    it("returns null when authorization header is missing", () => {
      const service = makeService();
      const req = makeRequest(undefined);

      expect(service.readBearerToken(req)).toBeNull();
    });

    it("returns null when scheme is not bearer", () => {
      const service = makeService();
      const req = makeRequest("Basic dXNlcjpwYXNz");

      expect(service.readBearerToken(req)).toBeNull();
    });

    it("returns null when token part is empty", () => {
      const service = makeService();
      const req = makeRequest("Bearer ");

      expect(service.readBearerToken(req)).toBeNull();
    });
  });
});
