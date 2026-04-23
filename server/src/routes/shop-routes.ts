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
import { isAllowedMimeType, type R2StorageService } from "../services/r2-storage-service.js";
import type { OutfitItem } from "../types/domain.js";

interface ShopRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  geminiExtractionService: GeminiExtractionService;
  geminiRecommendationService: GeminiRecommendationService;
  r2StorageService: R2StorageService;
}

interface ShopRecommendResponse {
  product: OutfitItem;
  outfits: Array<{
    styleNote: string;
    items: OutfitItem[];
  }>;
}

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
   * Analyzes an uploaded product image and suggests outfits from the user's
   * existing wardrobe that pair well with it. The temporary R2 object is
   * deleted after analysis; the client is expected to use its local preview URL
   * for the product thumbnail.
   *
   * Request body: { imageUrl: string, mimeType: string }
   * Response 200: { product: OutfitItem, outfits: Array<{ styleNote, items }> }
   */
  router.post("/shop/recommend", async (req, res): Promise<void> => {
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

      // 2. Validate body
      const body = (req.body as { imageUrl?: unknown; mimeType?: unknown }) ?? {};
      const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      const mimeType =
        typeof body.mimeType === "string" && body.mimeType.trim()
          ? body.mimeType.trim().toLowerCase()
          : "image/jpeg";

      if (!imageUrl) {
        res.status(400).json({ error: "imageUrl is required." });
        return;
      }

      // SSRF guard: only allow URLs that belong to our own R2 bucket
      if (!r2StorageService.ownsPublicUrl(imageUrl)) {
        res.status(400).json({ error: "imageUrl must point to an image in our storage bucket." });
        return;
      }

      if (!isAllowedMimeType(mimeType)) {
        res.status(400).json({
          error: "Invalid mimeType. Allowed: image/jpeg, image/png, image/webp."
        });
        return;
      }

      // 3. Check service availability
      if (!geminiExtractionService.isConfigured()) {
        res.status(503).json({ error: "Gemini extraction service is not configured." });
        return;
      }
      if (!geminiRecommendationService.isConfigured()) {
        res.status(503).json({ error: "Gemini recommendation service is not configured." });
        return;
      }

      // 4. Analyze the product image, then immediately delete the temporary R2 object.
      // The image bytes are already held in memory by Gemini at this point, so R2 is no longer needed.
      const extraction = await geminiExtractionService.analyzeClothingImage(imageUrl, mimeType);
      r2StorageService.deleteObject(imageUrl).catch((err) =>
        console.error("[shop/recommend] Failed to delete temporary image:", err)
      );

      const productCategory = extraction.category as OutfitCategory;
      // imageUrl is intentionally left empty: the temporary R2 object has been deleted.
      // The client substitutes its local preview URL for display.
      const product: OutfitItem = {
        id: "product",
        category: productCategory,
        name: extraction.name,
        imageUrl: "",
        tags: extraction.tags,
        description: extraction.description,
        isUserSelected: true,
        reason: null
      };

      const productContext: RecommendationItemContext = {
        id: "product",
        category: productCategory,
        name: extraction.name,
        tags: extraction.tags,
        description: extraction.description
      };

      // 5. Fetch user's wardrobe and build candidate pool (excluding product's category)
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

      // 6. If wardrobe is empty, return the product with a helpful note
      if (Object.keys(wardrobeByCategory).length === 0) {
        const response: ShopRecommendResponse = {
          product,
          outfits: [
            {
              styleNote: "Add analyzed items to your wardrobe to get outfit recommendations.",
              items: [product]
            }
          ]
        };
        res.json(response);
        return;
      }

      // 7. Ask Gemini for shop outfit suggestions
      const geminiResult = await geminiRecommendationService.recommendShopOutfits({
        productItem: productContext,
        wardrobeByCategory
      });

      // 8. Map Gemini result back to OutfitItem arrays (with hallucination guard)
      const wardrobeMap = new Map(allWardrobe.map((item) => [item.id, item]));

      const rawOutfits = geminiResult.outfits.map((geminiOutfit) => {
        const items: OutfitItem[] = [product];

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

        return {
          styleNote: geminiOutfit.styleNote,
          items
        };
      });

      // 9. Discard outfits where every selection was hallucinated (only the product remains)
      const outfits = rawOutfits.filter((o) => o.items.length > 1);

      // Fallback: if all outfits were filtered, return a single product-only outfit
      const finalOutfits =
        outfits.length > 0
          ? outfits
          : [
              {
                styleNote: "Add more analyzed items to your wardrobe to get outfit recommendations.",
                items: [product]
              }
            ];

      const response: ShopRecommendResponse = { product, outfits: finalOutfits };
      res.json(response);
    } catch (error) {
      console.error("Shop recommend error:", error);
      res.status(500).json({ error: "Failed to generate shop recommendations." });
    }
  });

  return router;
}
