import { Router } from "express";
import { ClosetRepository } from "../repositories/closet-repository.js";
import { ConversationRepository } from "../repositories/conversation-repository.js";
import { RecommendationRepository } from "../repositories/recommendation-repository.js";
import { AuthService } from "../services/auth-service.js";
import type { RecommendationRecord, RecommendationVote } from "../types/domain.js";

interface RecommendationRoutesDependencies {
  authService: AuthService;
  recommendationRepository: RecommendationRepository;
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
  conversationRepository,
  closetRepository
}: RecommendationRoutesDependencies): Router {
  const router = Router();

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
        conversations.filter((conversation) => conversation !== null).map((conversation) => [conversation.id, conversation])
      );

      const history = recommendations.map<RecommendationHistoryRecord>((recommendation) => {
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
          conversationTitle
        };
      }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      res.json({ recommendations: history });
    } catch (error) {
      console.error("Recommendation history error:", error);
      res.status(500).json({ error: "Failed to load recommendation history." });
    }
  });

  return router;
}
