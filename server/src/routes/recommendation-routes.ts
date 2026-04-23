import { Router } from "express";
import { ClosetRepository } from "../repositories/closet-repository.js";
import { ConversationRepository } from "../repositories/conversation-repository.js";
import { RecommendationRepository } from "../repositories/recommendation-repository.js";
import { UserRepository } from "../repositories/user-repository.js";
import { AuthService } from "../services/auth-service.js";
import { GeminiRecommendationService } from "../services/gemini-recommendation-service.js";
import { StyleSummaryThrottler } from "../services/style-summary-throttler.js";
import type { RecommendationRecord, RecommendationVote } from "../types/domain.js";

interface RecommendationRoutesDependencies {
  authService: AuthService;
  recommendationRepository: RecommendationRepository;
  userRepository: UserRepository;
  geminiRecommendationService: GeminiRecommendationService;
  conversationRepository: ConversationRepository;
  closetRepository: ClosetRepository;
}

interface RecommendationHistoryItemPhoto {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface RecommendationHistoryRecord extends Omit<RecommendationRecord, "items" | "occasions" | "vote"> {
  items: RecommendationHistoryItemPhoto[];
  occasions: string[];
  vote: RecommendationVote | null;
  conversationTitle: string | null;
}

function normalizeOccasions(occasions: string[], conversationTitle: string | null): string[] {
  const values = occasions.length > 0 ? occasions : conversationTitle ? [conversationTitle] : [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function createRecommendationRoutes({
  authService,
  recommendationRepository,
  userRepository,
  geminiRecommendationService,
  conversationRepository,
  closetRepository
}: RecommendationRoutesDependencies): Router {
  const router = Router();
  const throttler = new StyleSummaryThrottler(10_000);

  // Vote on a recommendation and refresh the user's style summary asynchronously.
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

      const updated = await recommendationRepository.updateVote(authResolution.user.id, recommendationId, vote);

      if (!updated) {
        res.status(404).json({ error: "Recommendation not found." });
        return;
      }

      res.json({ recommendation: updated });

      // Debounced: regenerate styleNote at most once per 10 s per user.
      // Rapid votes cancel the previous pending timer so only the final
      // state triggers a Gemini request.
      const userId = authResolution.user.id;
      throttler.schedule(userId, async () => {
        const user = await userRepository.findById(userId);
        if (!user?.profile) return;
        const votedRecs = await recommendationRepository.findVotedByUser(userId);
        if (votedRecs.length === 0) return;

        const allItemIds = [...new Set(votedRecs.flatMap((r) => r.items.map((i) => i.id)))];
        const closetItems = await closetRepository.findByIds(userId, allItemIds);
        const closetItemMap = new Map(closetItems.map((item) => [item.id, item]));

        const styleNote = await geminiRecommendationService.summarizeStyle(
          votedRecs.map((r: RecommendationRecord) => ({
            outfitName: r.outfitName,
            items: r.items.flatMap((item) => {
              const closetItem = closetItemMap.get(item.id);
              if (!closetItem) return [];
              return [{ id: item.id, name: item.name, category: closetItem.category, tags: closetItem.tags }];
            }),
            vote: r.vote!,
            updatedAt: r.updatedAt
          }))
        );
        if (styleNote) {
          await userRepository.updateProfile(userId, { ...user.profile, styleNote });
        }
      });
    } catch (error) {
      console.error("Recommendation vote error:", error);
      res.status(500).json({ error: "Failed to update vote." });
    }
  });

  router.get("/recommendations/history", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const userId = authResolution.user.id;
      const recommendations = await recommendationRepository.listByUser(userId);

      if (recommendations.length === 0) {
        const emptyHistory: RecommendationHistoryRecord[] = [];
        res.json({ recommendations: emptyHistory });
        return;
      }

      const [closetItems, conversations] = await Promise.all([
        closetRepository.findByIds(
          userId,
          recommendations.flatMap((recommendation) => recommendation.items.map((item) => item.id))
        ),
        Promise.all(
          [...new Set(recommendations.map((recommendation) => recommendation.conversationId))].map((conversationId) =>
            conversationRepository.findById(userId, conversationId)
          )
        )
      ]);

      const closetItemMap = new Map(closetItems.map((item) => [item.id, item]));
      const conversationMap = new Map(
        conversations
          .filter((conversation) => conversation !== null)
          .map((conversation) => [conversation.id, conversation])
      );

      const history = recommendations
        .map<RecommendationHistoryRecord>((recommendation) => {
          const conversation = conversationMap.get(recommendation.conversationId) ?? null;
          const conversationTitle = conversation?.title?.trim() || null;

          return {
            ...recommendation,
            items: recommendation.items.map((item) => ({
              id: item.id,
              name: item.name,
              imageUrl: closetItemMap.get(item.id)?.imageUrl ?? null
            })),
            occasions: normalizeOccasions(recommendation.occasions, conversationTitle),
            vote: recommendation.vote,
            conversationTitle
          };
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      res.json({ recommendations: history });
    } catch (error) {
      console.error("Recommendation history error:", error);
      res.status(500).json({ error: "Failed to load recommendation history." });
    }
  });

  return router;
}
