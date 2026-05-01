import type { UsageLimitRepository } from "../repositories/usage-limit-repository.js";

export type UsageAction =
  | "chat_message"
  | "outfit_generation"
  | "shop_recommend"
  | "shop_try_on"
  | "closet_analyze"
  | "closet_recommend";

// Daily limits per action type
export const DAILY_LIMITS: Record<UsageAction, number> = {
  chat_message: 30,
  outfit_generation: 10,
  shop_recommend: 10,
  shop_try_on: 5,
  closet_analyze: 40,
  closet_recommend: 10,
};

export interface UsageCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  resetDate: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export class UsageLimitService {
  constructor(private readonly repository: UsageLimitRepository) {}

  // Atomically records usage and returns whether the request is within the daily limit.
  // Increment happens before the check so concurrent requests can't bypass the limit.
  async checkAndRecord(userId: string, action: UsageAction): Promise<UsageCheckResult> {
    const dateKey = todayUtc();
    const limit = DAILY_LIMITS[action];
    const used = await this.repository.incrementAndGet(userId, action, dateKey);

    return {
      allowed: used <= limit,
      used,
      limit,
      resetDate: dateKey,
    };
  }
}
