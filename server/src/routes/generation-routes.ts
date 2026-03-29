import { Router } from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { ConversationRepository } from "../repositories/conversation-repository.js";
import type { GenerationRepository } from "../repositories/generation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { ImageGenerationService } from "../services/image-generation-service.js";
import type { R2StorageService } from "../services/r2-storage-service.js";
import type { GenerateOutfitRequest, GenerateOutfitResponse } from "../types/domain.js";

interface GenerationRoutesDependencies {
  authService: AuthService;
  userRepository: UserRepository;
  closetRepository: ClosetRepository;
  conversationRepository: ConversationRepository;
  generationRepository: GenerationRepository;
  imageGenerationService: ImageGenerationService;
  r2StorageService: R2StorageService;
}

export function createGenerationRoutes({
  authService,
  userRepository,
  closetRepository,
  conversationRepository,
  generationRepository,
  imageGenerationService,
  r2StorageService
}: GenerationRoutesDependencies): Router {
  const router = Router();

  /**
   * POST /api/generate/outfit
   *
   * Generates a realistic outfit image by combining the user's body image
   * with their selected clothing items via Gemini image generation.
   *
   * Request body: { clothingItemIds: string[], conversationId?, messageId?, outfitKey?, options?: { scene?, style?, prompt?, aspectRatio? } }
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
      const body = (req.body as GenerateOutfitRequest | undefined) ?? { clothingItemIds: [] };
      const clothingItemIds = Array.isArray(body.clothingItemIds) ? body.clothingItemIds : [];
      const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
      const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
      const outfitKey = typeof body.outfitKey === "string" ? body.outfitKey.trim() : "";

      if (clothingItemIds.length === 0) {
        res.status(400).json({
          success: false,
          result: null,
          message: "clothingItemIds is required and must not be empty."
        } satisfies GenerateOutfitResponse);
        return;
      }

      if ((conversationId || messageId || outfitKey) && (!conversationId || !messageId || !outfitKey)) {
        res.status(400).json({
          success: false,
          result: null,
          message: "conversationId, messageId, and outfitKey are all required to save a try-on image to chat history."
        } satisfies GenerateOutfitResponse);
        return;
      }

      const options = body.options ?? {};

      // 3. Fetch user profile and get body image URL
      const userId = authResolution.user.id;
      const user = await userRepository.findById(userId);
      const bodyImageUrl = user?.profile?.fullBodyImageUrl ?? null;

      if (!bodyImageUrl) {
        res.status(422).json({
          success: false,
          result: null,
          message: "User has no body image."
        } satisfies GenerateOutfitResponse);
        return;
      }

      // 4. Fetch clothing items and validate all have images
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

      // 5. Call Gemini to generate outfit image
      const generatedImageBuffer = await imageGenerationService.generateOutfitImage({
        bodyImageUrl,
        clothingImageUrls,
        ...(options.prompt ? { promptOverride: options.prompt } : {}),
        aspectRatio: options.aspectRatio ?? "3:4"
      });

      // 6. Upload generated image to R2
      const filename = `${Date.now()}-outfit.png`;
      const key = r2StorageService.buildGeneratedImageKey(userId, filename);
      const generatedImageUrl = await r2StorageService.uploadBuffer(key, generatedImageBuffer, "image/png");

      // 7. Save generation record to MongoDB
      await generationRepository.create(userId, clothingItemIds, generatedImageUrl);

      // 8. Persist the generated image onto the source chat message when identifiers are provided.
      if (conversationId && messageId && outfitKey) {
        const updatedConversation = await conversationRepository.attachTryOnImage(
          userId,
          conversationId,
          messageId,
          outfitKey,
          generatedImageUrl
        );

        if (!updatedConversation) {
          res.status(404).json({
            success: false,
            result: null,
            message: "Conversation message not found."
          } satisfies GenerateOutfitResponse);
          return;
        }
      }

      // 9. Return result
      res.json({
        success: true,
        result: {
          imageUrl: generatedImageUrl,
          generatedAt: new Date().toISOString()
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
