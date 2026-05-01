import type { NextFunction, Request, Response } from "express";
import type { SessionService } from "../services/session-service.js";
import type { UsageAction } from "../services/usage-limit-service.js";
import type { UsageLimitService } from "../services/usage-limit-service.js";

export function createUsageLimitMiddleware(
  sessionService: SessionService,
  usageLimitService: UsageLimitService,
  action: UsageAction
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = sessionService.readBearerToken(req);

      if (!token) {
        // No token — let the route handler return 401
        next();
        return;
      }

      const payload = sessionService.verifySessionToken(token);

      if (!payload) {
        // Invalid token — let the route handler return 401
        next();
        return;
      }

      const result = await usageLimitService.checkAndRecord(payload.userId, action);

      if (!result.allowed) {
        res.status(429).json({
          error: "Daily usage limit reached. Please try again tomorrow.",
          action,
          limit: result.limit,
          used: result.used,
          resetDate: result.resetDate,
        });
        return;
      }

      next();
    } catch (error) {
      // Fail open: don't block the request if the rate-limit check itself errors
      console.error("Usage limit middleware error:", error);
      next();
    }
  };
}
