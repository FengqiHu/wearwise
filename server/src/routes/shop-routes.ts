import multer from "multer";
import { Router } from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import {
  OUTFIT_CATEGORIES,
  type GeminiRecommendationService,
  type OutfitCategory,
  type RecommendationItemContext
} from "../services/gemini-recommendation-service.js";
import { isAllowedMimeType, R2StorageService } from "../services/r2-storage-service.js";
import type { OutfitItem } from "../types/domain.js";

interface ShopRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  geminiExtractionService: GeminiExtractionService;
  geminiRecommendationService: GeminiRecommendationService;
  r2StorageService: R2StorageService;
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
  r2StorageService
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

  return router;
}
