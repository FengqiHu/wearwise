import { Router } from "express";
import { ClosetRepository } from "../repositories/closet-repository.js";
import { GenerationRepository } from "../repositories/generation-repository.js";
import { RecommendationRepository } from "../repositories/recommendation-repository.js";
import { AccountDeletionRepository } from "../repositories/account-deletion-repository.js";
import { AuthService } from "../services/auth-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { GenerationRecord, RecommendationRecord, UserProfile } from "../types/domain.js";

interface AccountRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  recommendationRepository: RecommendationRepository;
  generationRepository: GenerationRepository;
  accountDeletionRepository: AccountDeletionRepository;
  r2StorageService: R2StorageService;
}

const PROFILE_IMAGE_FIELDS = ["avatarUrl", "headshotImageUrl", "fullBodyImageUrl"] as const;

function collectManagedProfileImageUrls(
  profile: UserProfile | null,
  r2StorageService: R2StorageService,
  imageUrls: Set<string>
): void {
  if (!profile) {
    return;
  }

  for (const field of PROFILE_IMAGE_FIELDS) {
    const imageUrl = profile[field];
    if (!imageUrl || !r2StorageService.ownsPublicUrl(imageUrl)) {
      continue;
    }

    imageUrls.add(imageUrl);
  }
}

function collectManagedRecommendationImageUrls(
  recommendations: RecommendationRecord[],
  r2StorageService: R2StorageService,
  imageUrls: Set<string>
): void {
  for (const recommendation of recommendations) {
    const imageUrl = recommendation.generation?.imageUrl;
    if (!imageUrl || !r2StorageService.ownsPublicUrl(imageUrl)) {
      continue;
    }

    imageUrls.add(imageUrl);
  }
}

function collectManagedGenerationImageUrls(
  generations: GenerationRecord[],
  r2StorageService: R2StorageService,
  imageUrls: Set<string>
): void {
  for (const generation of generations) {
    if (!r2StorageService.ownsPublicUrl(generation.generatedImageUrl)) {
      continue;
    }

    imageUrls.add(generation.generatedImageUrl);
  }
}

export function createAccountRoutes({
  authService,
  closetRepository,
  recommendationRepository,
  generationRepository,
  accountDeletionRepository,
  r2StorageService
}: AccountRoutesDependencies): Router {
  const router = Router();

  router.delete("/account", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const userId = authResolution.user.id;
      const managedImageUrls = new Set<string>();

      if (r2StorageService.isConfigured()) {
        const closetItems = await closetRepository.listAllByUser(userId);
        const recommendations = await recommendationRepository.listAllByUser(userId);
        const generations = await generationRepository.listAllByUser(userId);

        collectManagedProfileImageUrls(authResolution.user.profile, r2StorageService, managedImageUrls);

        for (const item of closetItems) {
          if (!r2StorageService.ownsPublicUrl(item.imageUrl)) {
            continue;
          }

          managedImageUrls.add(item.imageUrl);
        }

        collectManagedRecommendationImageUrls(recommendations, r2StorageService, managedImageUrls);
        collectManagedGenerationImageUrls(generations, r2StorageService, managedImageUrls);
      }

      await accountDeletionRepository.deleteUserData(userId);

      if (managedImageUrls.size > 0) {
        const managedImageUrlList = [...managedImageUrls];
        const cleanupResults = await Promise.allSettled(
          managedImageUrlList.map((imageUrl) => r2StorageService.deleteObject(imageUrl))
        );

        cleanupResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            return;
          }

          console.error(`Failed to delete account image: ${managedImageUrlList[index]}`, result.reason);
        });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Account deletion error:", error);
      res.status(500).json({ error: "Failed to delete account.", code: "ACCOUNT_DELETE_FAILED" });
    }
  });

  return router;
}
