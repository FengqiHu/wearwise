import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionService } from "../services/session-service.js";
import type { UsageLimitService, UsageAction } from "../services/usage-limit-service.js";
import { createUsageLimitMiddleware } from "./usage-limit.js";

const SECRET = "test-middleware-secret";
const TTL = 3600;

function makeSessionService() {
  return new SessionService(SECRET, TTL);
}

function makeUsageLimitService(allowed = true): UsageLimitService {
  return {
    checkAndRecord: vi.fn().mockResolvedValue({
      allowed,
      used: allowed ? 1 : 21,
      limit: 20,
      resetDate: "2026-04-30"
    })
  } as unknown as UsageLimitService;
}

async function startServer(
  sessionService: SessionService,
  usageLimitService: UsageLimitService,
  action: UsageAction = "chat_message"
): Promise<{ baseUrl: string; server: Server }> {
  const app = express();
  app.use(express.json());
  app.post(
    "/test",
    createUsageLimitMiddleware(sessionService, usageLimitService, action),
    (_req, res) => { res.json({ ok: true }); }
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function post(baseUrl: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({})
  });
}

describe("createUsageLimitMiddleware", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopServer(server);
      server = null;
    }
    vi.clearAllMocks();
  });

  it("passes through to next handler when usage is within the limit", async () => {
    const sessionService = makeSessionService();
    const token = sessionService.createSessionToken("user-1");
    const { baseUrl, server: s } = await startServer(sessionService, makeUsageLimitService(true));
    server = s;

    const res = await post(baseUrl, token);

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 429 when usage exceeds the daily limit", async () => {
    const sessionService = makeSessionService();
    const token = sessionService.createSessionToken("user-1");
    const { baseUrl, server: s } = await startServer(sessionService, makeUsageLimitService(false));
    server = s;

    const res = await post(baseUrl, token);

    expect(res.status).toBe(429);
  });

  it("includes action, limit, used, and resetDate in the 429 body", async () => {
    const sessionService = makeSessionService();
    const token = sessionService.createSessionToken("user-1");
    const { baseUrl, server: s } = await startServer(sessionService, makeUsageLimitService(false), "chat_message");
    server = s;

    const res = await post(baseUrl, token);
    const body = await res.json() as Record<string, unknown>;

    expect(body.action).toBe("chat_message");
    expect(typeof body.limit).toBe("number");
    expect(typeof body.used).toBe("number");
    expect(typeof body.resetDate).toBe("string");
    expect(typeof body.error).toBe("string");
  });

  it("passes through without calling checkAndRecord when no auth token is present", async () => {
    const sessionService = makeSessionService();
    const usageLimitService = makeUsageLimitService(true);
    const { baseUrl, server: s } = await startServer(sessionService, usageLimitService);
    server = s;

    const res = await post(baseUrl);

    expect(res.status).toBe(200);
    expect(usageLimitService.checkAndRecord).not.toHaveBeenCalled();
  });

  it("passes through without calling checkAndRecord when the token is invalid", async () => {
    const sessionService = makeSessionService();
    const usageLimitService = makeUsageLimitService(true);
    const { baseUrl, server: s } = await startServer(sessionService, usageLimitService);
    server = s;

    const res = await post(baseUrl, "not.a.real.token");

    expect(res.status).toBe(200);
    expect(usageLimitService.checkAndRecord).not.toHaveBeenCalled();
  });

  it("passes through (fail-open) when checkAndRecord throws", async () => {
    const sessionService = makeSessionService();
    const token = sessionService.createSessionToken("user-1");
    const usageLimitService = {
      checkAndRecord: vi.fn().mockRejectedValue(new Error("MongoDB unavailable"))
    } as unknown as UsageLimitService;
    const { baseUrl, server: s } = await startServer(sessionService, usageLimitService);
    server = s;

    const res = await post(baseUrl, token);

    expect(res.status).toBe(200);
  });

  it("calls checkAndRecord with the userId extracted from the token", async () => {
    const sessionService = makeSessionService();
    const token = sessionService.createSessionToken("user-99");
    const usageLimitService = makeUsageLimitService(true);
    const { baseUrl, server: s } = await startServer(sessionService, usageLimitService, "outfit_generation");
    server = s;

    await post(baseUrl, token);

    expect(usageLimitService.checkAndRecord).toHaveBeenCalledWith("user-99", "outfit_generation");
  });
});
