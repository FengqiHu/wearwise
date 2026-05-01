import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageLimitRepository } from "../repositories/usage-limit-repository.js";
import { DAILY_LIMITS, UsageLimitService } from "./usage-limit-service.js";

function makeRepository(count: number): UsageLimitRepository {
  return {
    incrementAndGet: vi.fn().mockResolvedValue(count)
  } as unknown as UsageLimitRepository;
}

describe("UsageLimitService.checkAndRecord", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns allowed: true when count is within the daily limit", async () => {
    const repository = makeRepository(1);
    const service = new UsageLimitService(repository);

    const result = await service.checkAndRecord("user-1", "chat_message");

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.limit).toBe(DAILY_LIMITS.chat_message);
  });

  it("returns allowed: true when count exactly equals the limit", async () => {
    const limit = DAILY_LIMITS.shop_try_on;
    const repository = makeRepository(limit);
    const service = new UsageLimitService(repository);

    const result = await service.checkAndRecord("user-1", "shop_try_on");

    expect(result.allowed).toBe(true);
  });

  it("returns allowed: false when count exceeds the limit by one", async () => {
    const limit = DAILY_LIMITS.outfit_generation;
    const repository = makeRepository(limit + 1);
    const service = new UsageLimitService(repository);

    const result = await service.checkAndRecord("user-1", "outfit_generation");

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(limit + 1);
    expect(result.limit).toBe(limit);
  });

  it("passes today's UTC date as the dateKey", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T23:59:59Z"));

    const repository = makeRepository(1);
    const service = new UsageLimitService(repository);

    await service.checkAndRecord("user-42", "closet_analyze");

    expect(repository.incrementAndGet).toHaveBeenCalledWith("user-42", "closet_analyze", "2026-04-30");
  });

  it("includes resetDate matching the UTC date key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T00:00:00Z"));

    const repository = makeRepository(1);
    const service = new UsageLimitService(repository);

    const result = await service.checkAndRecord("user-1", "shop_recommend");

    expect(result.resetDate).toBe("2026-04-30");
  });

  it("delegates to the repository with the correct userId and action", async () => {
    const repository = makeRepository(3);
    const service = new UsageLimitService(repository);

    await service.checkAndRecord("user-xyz", "closet_recommend");

    expect(repository.incrementAndGet).toHaveBeenCalledOnce();
    expect(repository.incrementAndGet).toHaveBeenCalledWith("user-xyz", "closet_recommend", expect.any(String));
  });
});
