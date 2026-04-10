import { Router } from "express";
import { RecommendationRepository } from "../repositories/recommendation-repository.js";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import type { RecommendationRecord } from "../types/domain.js";

interface RecommendationRoutesDependencies {
  authService: AuthService;
  recommendationRepository: RecommendationRepository;
  userRepository: UserRepository;
  geminiRecommendationService: GeminiRecommendationService;
}

export function createRecommendationRoutes({ authService, recommendationRepository, userRepository, geminiRecommendationService }: RecommendationRoutesDependencies): Router {
  const router = Router();

  // vote on a recommendation
  router.patch("/recommendations/:recommendationId/vote", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const recommendationId = (req.params.recommendationId ?? "").trim();

      if (!recommendationId) {
        res.status(400).json({ error: "recommendationId is required." });
        return;
      }

      const { vote } = req.body as { vote?: unknown };

      if (vote !== "up" && vote !== "down" && vote !== null) {
        res.status(400).json({ error: "vote must be 'up', 'down', or null." });
        return;
      }

      const updated = await recommendationRepository.updateVote(
        authResolution.user.id,
        recommendationId,
        vote
      );

      if (!updated) {
        res.status(404).json({ error: "Recommendation not found." });
        return;
      }

      res.json({ recommendation: updated });

      // Fire-and-forget: regenerate styleNote from full vote history
      const userId = authResolution.user.id;
      (async () => {
        try {
          const user = await userRepository.findById(userId);
          if (!user?.profile) return;
          const votedRecs = await recommendationRepository.findVotedByUser(userId);
          if (votedRecs.length === 0) return;
          const styleNote = await geminiRecommendationService.summarizeStyle(
            votedRecs.map((r: RecommendationRecord) => ({ outfitName: r.outfitName, items: r.items, vote: r.vote!, updatedAt: r.updatedAt }))
          );
          if (styleNote) {
            await userRepository.updateProfile(userId, { ...user.profile, styleNote });
          }
        } catch (err) {
          console.error("Style summary update failed:", err);
        }
      })();
    } catch (error) {
      console.error("Recommendation vote error:", error);
      res.status(500).json({ error: "Failed to update vote." });
    }
  });

  return router;
}
