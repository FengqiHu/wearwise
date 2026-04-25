import multer from "multer";
import { Router } from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { GenerationRepository } from "../repositories/generation-repository.js";
import type { RecommendationRepository } from "../repositories/recommendation-repository.js";
import type { UserRepository } from "../repositories/user-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import {
  OUTFIT_CATEGORIES,
  type GeminiRecommendationService,
  type OutfitCategory,
  type RecommendationItemContext
} from "../services/gemini-recommendation-service.js";
import type { ImageGenerationService } from "../services/image-generation-service.js";
import { isAllowedMimeType, R2StorageService } from "../services/r2-storage-service.js";
import type { GenerateOutfitResponse, OutfitItem } from "../types/domain.js";

interface ShopRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  geminiExtractionService: GeminiExtractionService;
  geminiRecommendationService: GeminiRecommendationService;
  r2StorageService: R2StorageService;
  userRepository: UserRepository;
  imageGenerationService: ImageGenerationService;
  generationRepository: GenerationRepository;
  recommendationRepository: RecommendationRepository;
}

interface ShopProductItem {
  /** R2 key — used by the try-on endpoint to locate the image */
  key: string;
  /** Public R2 URL */
  imageUrl: string;
  name: string;
  category: string;
  tags: string[];
  description: string;
}

interface ShopRecommendResponse {
  product: ShopProductItem;
  outfits: Array<{
    styleNote: string;
    items: OutfitItem[];
  }>;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type '${file.mimetype}'. Allowed: image/jpeg, image/png, image/webp.`));
    }
  }
});

export function createShopRoutes({
  authService,
  closetRepository,
  geminiExtractionService,
  geminiRecommendationService,
  r2StorageService,
  userRepository,
  imageGenerationService,
  generationRepository,
  recommendationRepository
}: ShopRoutesDependencies): Router {
  const router = Router();

  /**
   * POST /api/shop/recommend
   *
   * Accepts a multipart image upload of a product the user is considering buying.
   * Stores the image in R2 under a `shop/` prefix (not added to the wardrobe),
   * runs Gemini extraction to identify the item, and returns outfit recommendations
   * pairing it with the user's existing closet.
   *
   * Request: multipart/form-data  { image: <file> }
   * Response 200: { product: ShopProductItem, outfits: Array<{ styleNote, items }> }
   */
  router.post("/shop/recommend", upload.single("image"), async (req, res): Promise<void> => {
    try {
      // 1. Authenticate
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }
      const user = authResolution.user;

      // 2. Validate uploaded file
      if (!req.file) {
        res.status(400).json({ error: "An image file is required (field name: image)." });
        return;
      }

      const mimeType = req.file.mimetype;

      if (!isAllowedMimeType(mimeType)) {
        res.status(400).json({
          error: `Unsupported image type '${mimeType}'. Allowed: image/jpeg, image/png, image/webp.`
        });
        return;
      }

      // 3. Check service availability
      if (!r2StorageService.isConfigured()) {
        res.status(503).json({ error: "Storage service is not configured." });
        return;
      }
      if (!geminiExtractionService.isConfigured()) {
        res.status(503).json({ error: "Gemini extraction service is not configured." });
        return;
      }
      if (!geminiRecommendationService.isConfigured()) {
        res.status(503).json({ error: "Gemini recommendation service is not configured." });
        return;
      }

      // 4. Upload image to R2 under `shop/` prefix (not the closet collection)
      const { publicUrl: imageUrl, key } = await r2StorageService.uploadShopImage(
        user.id,
        req.file.buffer,
        mimeType
      );

      // 5. Analyze the product image with Gemini
      const extraction = await geminiExtractionService.analyzeClothingImage(imageUrl, mimeType);

      const productCategory = extraction.category as OutfitCategory;
      const product: ShopProductItem = {
        key,
        imageUrl,
        name: extraction.name,
        category: productCategory,
        tags: extraction.tags,
        description: extraction.description
      };

      const productContext: RecommendationItemContext = {
        id: key,
        category: productCategory,
        name: extraction.name,
        tags: extraction.tags,
        description: extraction.description
      };

      // 6. Fetch the user's wardrobe and group ready items by category (skip product's category)
      const allWardrobe = await closetRepository.listByUser(user.id, 1_000);

      const wardrobeByCategory: Partial<Record<OutfitCategory, RecommendationItemContext[]>> = {};
      for (const category of OUTFIT_CATEGORIES) {
        if (category === productCategory) continue;

        const candidates = allWardrobe
          .filter(
            (item) =>
              item.analysisStatus === "ready" &&
              item.category === category &&
              item.name &&
              item.description
          )
          .map<RecommendationItemContext>((item) => ({
            id: item.id,
            category,
            name: item.name!,
            tags: item.tags,
            description: item.description!
          }));

        if (candidates.length > 0) {
          wardrobeByCategory[category] = candidates;
        }
      }

      // 7. If wardrobe is empty, return product-only outfit with a helpful note
      if (Object.keys(wardrobeByCategory).length === 0) {
        const outfitProductItem: OutfitItem = {
          id: key,
          category: productCategory,
          name: extraction.name,
          imageUrl,
          tags: extraction.tags,
          description: extraction.description,
          isUserSelected: true,
          reason: null
        };
        const response: ShopRecommendResponse = {
          product,
          outfits: [
            {
              styleNote: "Add analyzed items to your wardrobe to see outfit pairings.",
              items: [outfitProductItem]
            }
          ]
        };
        res.json(response);
        return;
      }

      // 8. Ask Gemini for 1–3 distinct outfit suggestions
      const geminiResult = await geminiRecommendationService.recommendShopOutfits({
        productItem: productContext,
        wardrobeByCategory
      });

      // 9. Map Gemini selections back to OutfitItem arrays (hallucination guard)
      const wardrobeMap = new Map(allWardrobe.map((item) => [item.id, item]));

      const productOutfitItem: OutfitItem = {
        id: key,
        category: productCategory,
        name: extraction.name,
        imageUrl,
        tags: extraction.tags,
        description: extraction.description,
        isUserSelected: true,
        reason: null
      };

      const outfits = geminiResult.outfits.map((geminiOutfit) => {
        const items: OutfitItem[] = [productOutfitItem];

        for (const selection of geminiOutfit.selections) {
          const wardrobeItem = wardrobeMap.get(selection.itemId);
          if (!wardrobeItem) continue; // skip hallucinated IDs

          items.push({
            id: wardrobeItem.id,
            category: wardrobeItem.category ?? selection.category,
            name: wardrobeItem.name ?? "Unknown",
            imageUrl: wardrobeItem.imageUrl,
            tags: wardrobeItem.tags,
            description: wardrobeItem.description ?? "",
            isUserSelected: false,
            reason: selection.reason
          });
        }

        return { styleNote: geminiOutfit.styleNote, items };
      });

      const response: ShopRecommendResponse = { product, outfits };
      res.json(response);
    } catch (error) {
      console.error("Shop recommend error:", error);
      res.status(500).json({ error: "Failed to generate shop recommendations." });
    }
  });

  /**
   * POST /api/shop/try-on
   *
   * Generates a try-on image combining the user's body photo, a shop product image
   * (identified by its R2 key), and optional wardrobe items.
   *
   * Request body: { productKey: string, clothingItemIds?: string[], outfitName?: string, productName?: string }
   * Response 200: { success: true, result: { imageUrl, generatedAt } }
   */
  router.post("/shop/try-on", async (req, res): Promise<void> => {
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
      const userId = authResolution.user.id;

      // 2. Check service availability
      if (!imageGenerationService.isConfigured()) {
        res.status(503).json({
          success: false,
          result: null,
          message: "Image generation service is not configured."
        } satisfies GenerateOutfitResponse);
        return;
      }

      // 3. Parse and validate request body
      const body = req.body as {
        productKey?: unknown;
        clothingItemIds?: unknown;
        outfitName?: unknown;
        productName?: unknown;
      };
      const productKey = typeof body.productKey === "string" ? body.productKey.trim() : "";
      const clothingItemIds = Array.isArray(body.clothingItemIds)
        ? (body.clothingItemIds as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      const outfitName = typeof body.outfitName === "string" ? body.outfitName.trim() : "";
      const productName = typeof body.productName === "string" ? body.productName.trim() : "Online item";

      if (!productKey) {
        res.status(400).json({
          success: false,
          result: null,
          message: "productKey is required."
        } satisfies GenerateOutfitResponse);
        return;
      }

      const expectedPrefix = `${userId}/online-items/`;
      if (!productKey.startsWith(expectedPrefix)) {
        res.status(403).json({
          success: false,
          result: null,
          message: "Access denied: productKey does not belong to the current user."
        } satisfies GenerateOutfitResponse);
        return;
      }

      // 4. Fetch user profile for body image
      const user = await userRepository.findById(userId);
      const bodyImageUrl = user?.profile?.fullBodyImageUrl ?? null;
      const headshotImageUrl = user?.profile?.headshotImageUrl ?? null;

      if (!bodyImageUrl) {
        res.status(422).json({
          success: false,
          result: null,
          message: "You need to upload a full-body photo in your profile before generating a try-on image."
        } satisfies GenerateOutfitResponse);
        return;
      }

      // 5. Build product image URL from key
      const productImageUrl = r2StorageService.publicUrlForKey(productKey);

      // 6. Fetch wardrobe clothing items (if any)
      const clothingImageUrls: string[] = [productImageUrl];
      const fetchedWardrobeItems: Array<{ id: string; name: string }> = [];

      if (clothingItemIds.length > 0) {
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
          clothingImageUrls.push(item.imageUrl);
          fetchedWardrobeItems.push({ id: item.id, name: item.name ?? "Unknown" });
        }
      }

      // 7. Generate the try-on image
      const generatedImageBuffer = await imageGenerationService.generateOutfitImage({
        bodyImageUrl,
        ...(headshotImageUrl ? { headshotImageUrl } : {}),
        clothingImageUrls,
        aspectRatio: "3:4"
      });

      // 8. Upload generated image to R2
      const filename = `${Date.now()}-shop-tryon.png`;
      const key = r2StorageService.buildGeneratedImageKey(userId, filename);
      const generatedImageUrl = await r2StorageService.uploadBuffer(key, generatedImageBuffer, "image/png");

      const generatedAt = new Date().toISOString();

      // 9. Save generation record
      await generationRepository.create(userId, clothingItemIds, generatedImageUrl);

      // 10. Save recommendation record so the try-on appears in history
      const recommendationItems = [
        { id: productKey, name: productName },
        ...fetchedWardrobeItems
      ];
      const label = outfitName || productName;
      const rec = await recommendationRepository.create({
        userId,
        outfitName: label,
        reason: label,
        items: recommendationItems,
        occasions: [],
        weather: null,
        conversationId: "",
        messageId: ""
      });
      await recommendationRepository.updateGeneration(userId, rec.id, {
        imageUrl: generatedImageUrl,
        createdAt: generatedAt
      });

      res.json({
        success: true,
        result: { imageUrl: generatedImageUrl, generatedAt }
      } satisfies GenerateOutfitResponse);
    } catch (error) {
      console.error("Shop try-on error:", error);
      res.status(500).json({
        success: false,
        result: null,
        message: "Failed to generate try-on image."
      } satisfies GenerateOutfitResponse);
    }
  });

  return router;
}
