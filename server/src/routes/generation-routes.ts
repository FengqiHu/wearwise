import { Router } from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { GenerationRepository } from "../repositories/generation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { ImageGenerationService } from "../services/image-generation-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { GenerateOutfitRequest, GenerateOutfitResponse } from "../types/domain.js";

interface GenerationRoutesDependencies {
  authService: AuthService;
  userRepository: UserRepository;
  closetRepository: ClosetRepository;
  generationRepository: GenerationRepository;
  recommendationRepository: RecommendationRepository;
  imageGenerationService: ImageGenerationService;
  r2StorageService: R2StorageService;
}

export function createGenerationRoutes({
  authService,
  userRepository,
  closetRepository,
  generationRepository,
  recommendationRepository,
  imageGenerationService,
  r2StorageService
}: GenerationRoutesDependencies): Router {
  const router = Router();

  /**
   * POST /api/generate/outfit
   *
   * Generates a realistic outfit image by combining the user's body image
   * with the clothing items from a recommendation via Gemini image generation.
   *
   * Request body: { recommendationId: string, options?: { scene?, style?, prompt?, aspectRatio? } }
   * Response 200: { success: true, result: { imageUrl, generatedAt } }
   */
  router.post("/generate/outfit", async (req, res): Promise<void> => {
    try {
      // 1. Authenticate
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          success: false,
          result: null,
          message: authResolution.error?.message ?? "Unauthorized."
        } satisfies GenerateOutfitResponse);
        return;
      }

      if (!imageGenerationService.isConfigured()) {
        res.status(503).json({
          success: false,
          result: null,
          message: "Image generation service is not configured."
        } satisfies GenerateOutfitResponse);
        return;
      }

      // 2. Parse request body
      const body = (req.body as GenerateOutfitRequest | undefined) ?? {};
      const recommendationId = typeof body.recommendationId === "string" ? body.recommendationId.trim() : "";
      const directClothingItemIds = Array.isArray(body.clothingItemIds) ? body.clothingItemIds : [];

      if (!recommendationId && directClothingItemIds.length === 0) {
        res.status(400).json({
          success: false,
          result: null,
          message: "Either recommendationId or clothingItemIds is required."
        } satisfies GenerateOutfitResponse);
        return;
      }

      const options = body.options ?? {};
      const userId = authResolution.user.id;

      // 3. Resolve clothing item IDs — from recommendation or directly provided
      let clothingItemIds: string[];
      let recommendationOutfitName: string | undefined;

      if (recommendationId) {
        const recommendation = await recommendationRepository.findById(userId, recommendationId);
        if (!recommendation) {
          res.status(404).json({
            success: false,
            result: null,
            message: "Recommendation not found."
          } satisfies GenerateOutfitResponse);
          return;
        }
        clothingItemIds = recommendation.items.map((item) => item.id);
        recommendationOutfitName = recommendation.outfitName;
      } else {
        clothingItemIds = directClothingItemIds;
      }

      // 4. Fetch user profile and get body image URL
      const user = await userRepository.findById(userId);
      const bodyImageUrl = user?.profile?.fullBodyImageUrl ?? null;
      const headshotImageUrl = user?.profile?.headshotImageUrl ?? null;

      if (!bodyImageUrl) {
        res.status(422).json({
          success: false,
          result: null,
          message: "User has no body image."
        } satisfies GenerateOutfitResponse);
        return;
      }

      // 5. Fetch clothing items and validate all have images
      const clothingItems = await Promise.all(
        clothingItemIds.map((id) => closetRepository.findById(userId, id))
      );

      for (const item of clothingItems) {
        if (!item || !item.imageUrl) {
          res.status(422).json({
            success: false,
            result: null,
            message: "Clothing item not found or has no image."
          } satisfies GenerateOutfitResponse);
          return;
        }
      }

      const clothingImageUrls = clothingItems.map((item) => item!.imageUrl);

      // 6. Call Gemini to generate outfit image
      const backgroundParts = [recommendationOutfitName, options.weatherSummary].filter(Boolean);
      const backgroundContext = !options.prompt && backgroundParts.length > 0
        ? backgroundParts.join(", ")
        : undefined;

      const generatedImageBuffer = await imageGenerationService.generateOutfitImage({
        bodyImageUrl,
        ...(headshotImageUrl ? { headshotImageUrl } : {}),
        clothingImageUrls,
        ...(options.prompt ? { promptOverride: options.prompt } : {}),
        aspectRatio: options.aspectRatio ?? "3:4",
        backgroundContext
      });

      // 7. Upload generated image to R2
      const filename = `${Date.now()}-outfit.png`;
      const key = r2StorageService.buildGeneratedImageKey(userId, filename);
      const generatedImageUrl = await r2StorageService.uploadBuffer(key, generatedImageBuffer, "image/png");

      // 8. Save generation record to MongoDB (historical log)
      await generationRepository.create(userId, clothingItemIds, generatedImageUrl);

      // 9. Update the recommendation with the generation data (when applicable)
      const generatedAt = new Date().toISOString();
      if (recommendationId) {
        await recommendationRepository.updateGeneration(userId, recommendationId, {
          imageUrl: generatedImageUrl,
          createdAt: generatedAt
        });
      }

      // 10. Return result
      res.json({
        success: true,
        result: {
          imageUrl: generatedImageUrl,
          generatedAt
        }
      } satisfies GenerateOutfitResponse);
    } catch (error) {
      console.error("Outfit generation error:", error);
      res.status(500).json({
        success: false,
        result: null,
        message: "Failed to generate outfit image."
      } satisfies GenerateOutfitResponse);
    }
  });

  return router;
}
