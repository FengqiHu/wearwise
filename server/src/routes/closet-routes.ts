import express, { type Request, type Response, Router } from "express";
import { z } from "zod";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import {
  OUTFIT_CATEGORIES,
  type GeminiRecommendationService,
  type OutfitCategory,
  type RecommendationItemContext
} from "../services/gemini-recommendation-service.js";
import {
  ImageModerationRejectedError,
  ImageModerationUnavailableError
} from "../services/image-moderation-service.js";
import {
  ClothingPresenceRejectedError,
  ClothingPresenceUnavailableError
} from "../services/gemini-clothing-presence-service.js";
import { isAllowedMimeType, R2StorageService } from "../services/r2-storage-service.js";
import type { ReviewedImageStorageService } from "../services/reviewed-image-storage-service.js";
import type { ClosetItemRecord, RecommendOutfitResponse } from "../types/domain.js";

interface ClosetRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  r2StorageService: R2StorageService;
  reviewedImageStorageService: ReviewedImageStorageService;
  geminiExtractionService: GeminiExtractionService;
  geminiRecommendationService: GeminiRecommendationService;
}

const IMAGE_UPLOAD_LIMIT = "20mb";

function normalizeImageContentType(rawHeader: string | string[] | undefined): string {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

const rawImageBodyParser = express.raw({
  limit: IMAGE_UPLOAD_LIMIT,
  type: (req) => normalizeImageContentType(req.headers["content-type"]).startsWith("image/")
});

/**
 * Narrows a raw ClosetItemRecord to a fully-ready item with non-null
 * category, name, and description. Returns null if any field is missing
 * or the category is not a recognised OutfitCategory.
 */
type ReadyClosetItem = ClosetItemRecord & {
  analysisStatus: "ready";
  category: OutfitCategory;
  name: string;
  description: string;
};

function toReadyClosetItem(item: ClosetItemRecord): ReadyClosetItem | null {
  if (item.analysisStatus !== "ready") {
    return null;
  }

  if (!item.category || !item.name || !item.description) {
    return null;
  }

  if (!(OUTFIT_CATEGORIES as readonly string[]).includes(item.category)) {
    return null;
  }

  return {
    ...item,
    analysisStatus: "ready",
    category: item.category as OutfitCategory,
    name: item.name,
    description: item.description
  };
}

function toRecommendationContext(item: ReadyClosetItem): RecommendationItemContext {
  return {
    id: item.id,
    category: item.category,
    name: item.name,
    tags: item.tags,
    description: item.description
  };
}

const importClosetItemSchema = z.object({
  imageUrl: z.string().url(),
  analysisStatus: z.enum(["pending", "ready", "error"]),
  analysisError: z.string().nullable(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  description: z.string().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const importClosetItemsRequestSchema = z.object({
  items: z.array(importClosetItemSchema).min(1).max(200)
});

export function createClosetRoutes({
  authService,
  closetRepository,
  r2StorageService,
  reviewedImageStorageService,
  geminiExtractionService,
  geminiRecommendationService
}: ClosetRoutesDependencies): Router {
  const router = Router();

  async function requireAuth(req: Request, res: Response) {
    const authResolution = await authService.resolveAuthenticatedUser(req);
    if (!authResolution.user || authResolution.error) {
      res.status(authResolution.error?.status ?? 401).json({
        error: authResolution.error?.message ?? "Unauthorized."
      });
      return null;
    }
    return authResolution.user;
  }

  /**
   * GET /api/closet/items
   *
   * Returns the authenticated user's closet items, newest first.
   */
  router.get("/closet/items", async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      const items = await closetRepository.listByUser(user.id);
      res.json({ items });
    } catch (error) {
      console.error("Closet list error:", error);
      res.status(500).json({ error: "Failed to fetch closet items." });
    }
  });

  /**
   * POST /api/closet/items
   *
   * Reviews the uploaded image, stores it in R2, and creates a new closet item.
   *
   * Request body: raw image bytes (image/jpeg, image/png, image/webp)
   * Response 201: { item: ClosetItemRecord }
   */
  router.post("/closet/items", rawImageBodyParser, async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      if (!reviewedImageStorageService.isClosetImageReviewConfigured()) {
        res.status(503).json({ error: "Image upload is temporarily unavailable. Please try again later." });
        return;
      }

      const contentType = normalizeImageContentType(req.headers["content-type"]);

      if (!contentType) {
        res.status(400).json({ error: "Invalid image content type." });
        return;
      }

      if (!isAllowedMimeType(contentType)) {
        res.status(400).json({
          error: `Invalid content type '${contentType}'. Allowed: image/jpeg, image/png, image/webp.`
        });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: "Image upload body is required." });
        return;
      }

      const uploadedImage = await reviewedImageStorageService.storeUserImage({
        userId: user.id,
        folder: "closet",
        fileName: typeof req.query.fileName === "string" ? req.query.fileName : null,
        contentType,
        buffer
      });

      try {
        const item = await closetRepository.create(user.id, uploadedImage.publicUrl);
        res.status(201).json({ item });
      } catch (persistError) {
        if (r2StorageService.isConfigured() && r2StorageService.ownsPublicUrl(uploadedImage.publicUrl)) {
          try {
            await r2StorageService.deleteObject(uploadedImage.publicUrl);
          } catch (cleanupError) {
            console.error("Failed to clean up rejected closet upload.", cleanupError);
          }
        }

        throw persistError;
      }
    } catch (error) {
      if (error instanceof ImageModerationRejectedError) {
        console.warn("Closet image upload rejected by SafeSearch.", {
          findings: error.findings,
          annotation: error.annotation
        });
        res.status(422).json({ error: error.message });
        return;
      }

      if (error instanceof ImageModerationUnavailableError) {
        console.error("Closet image upload blocked because moderation is unavailable.", error.cause);
        res.status(503).json({ error: error.message });
        return;
      }

      if (error instanceof ClothingPresenceRejectedError) {
        console.warn("Closet image upload rejected by Gemini clothing-presence review.", {
          reason: error.reason
        });
        res.status(422).json({ error: error.message });
        return;
      }

      if (error instanceof ClothingPresenceUnavailableError) {
        console.error("Closet image upload blocked because clothing-presence review is unavailable.", error.cause);
        res.status(503).json({ error: error.message });
        return;
      }

      console.error("Closet item upload error:", error);
      res.status(500).json({ error: "Failed to create closet item." });
    }
  });

  /**
   * POST /api/closet/items/import-test-data
   *
   * Imports pre-analyzed closet items for the authenticated user.
   * Intended for local/demo sample data seeding from the client.
   */
  router.post("/closet/items/import-test-data", async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      const parsed = importClosetItemsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid import payload." });
        return;
      }

      const imported = await closetRepository.importMany(user.id, parsed.data.items);
      res.status(201).json({ items: imported });
    } catch (error) {
      console.error("Closet test data import error:", error);
      res.status(500).json({ error: "Failed to import test closet items." });
    }
  });

  /**
   * GET /api/closet/items/:id
   *
   * Returns a single closet item by ID for the authenticated user.
   * Exposes analysisStatus and analysisError for retry and debugging.
   *
   * Response 200: { item: ClosetItemRecord }
   */
  router.get("/closet/items/:id", async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(user.id, itemId);
      if (!item) {
        res.status(404).json({ error: "Closet item not found." });
        return;
      }

      res.json({ item });
    } catch (error) {
      console.error("Closet item fetch error:", error);
      res.status(500).json({ error: "Failed to fetch closet item." });
    }
  });

  /**
   * PATCH /api/closet/items/:id
   *
   * Updates editable metadata fields: name, category, tags, description.
   * All fields are optional; only provided fields are updated.
   *
   * Request body (JSON): { name?, category?, tags?, description? }
   * Response 200: { item: ClosetItemRecord }
   */
  router.patch("/closet/items/:id", async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(user.id, itemId);
      if (!item) {
        res.status(404).json({ error: "Closet item not found." });
        return;
      }

      const body = (req.body as {
        name?: unknown;
        category?: unknown;
        tags?: unknown;
        description?: unknown;
      } | undefined) ?? {};

      const update: { name?: string; category?: string; tags?: string[]; description?: string } = {};

      if (typeof body.name === "string") update.name = body.name.trim();
      if (typeof body.category === "string") update.category = body.category.trim();
      if (typeof body.description === "string") update.description = body.description.trim();
      if (Array.isArray(body.tags) && body.tags.every((t) => typeof t === "string")) {
        update.tags = (body.tags as string[]).map((t) => t.trim()).filter(Boolean);
      }

      if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "No valid fields provided for update." });
        return;
      }

      const updated = await closetRepository.updateMetadata(user.id, itemId, update);
      res.json({ item: updated });
    } catch (error) {
      console.error("Closet item metadata update error:", error);
      res.status(500).json({ error: "Failed to update closet item." });
    }
  });

  /**
   * DELETE /api/closet/items/:id
   *
   * Deletes a closet item: removes the MongoDB record and the R2 image.
   * Response 204: no body
   */
  router.delete("/closet/items/:id", async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(user.id, itemId);
      if (!item) {
        res.status(404).json({ error: "Closet item not found." });
        return;
      }

      await closetRepository.deleteById(user.id, itemId);

      if (r2StorageService.isConfigured() && r2StorageService.ownsPublicUrl(item.imageUrl)) {
        await r2StorageService.deleteObject(item.imageUrl);
      }

      res.status(204).send();
    } catch (error) {
      console.error("Closet item delete error:", error);
      res.status(500).json({ error: "Failed to delete closet item." });
    }
  });

  /**
   * PUT /api/closet/items/:id/image
   *
   * Reviews and replaces the image of a closet item, then resets the item's
   * analysis status to "pending".
   *
   * Request body: raw image bytes (image/jpeg, image/png, image/webp)
   * Response 200: { item: ClosetItemRecord }
   */
  router.put("/closet/items/:id/image", rawImageBodyParser, async (req, res): Promise<void> => {
    try {
      const user = await requireAuth(req, res);
      if (!user) return;

      if (!reviewedImageStorageService.isClosetImageReviewConfigured()) {
        res.status(503).json({ error: "Image upload is temporarily unavailable. Please try again later." });
        return;
      }

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(user.id, itemId);
      if (!item) {
        res.status(404).json({ error: "Closet item not found." });
        return;
      }

      const contentType = normalizeImageContentType(req.headers["content-type"]);

      if (!contentType) {
        res.status(400).json({ error: "Invalid image content type." });
        return;
      }

      if (!isAllowedMimeType(contentType)) {
        res.status(400).json({
          error: `Invalid content type '${contentType}'. Allowed: image/jpeg, image/png, image/webp.`
        });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: "Image upload body is required." });
        return;
      }

      const uploadedImage = await reviewedImageStorageService.storeUserImage({
        userId: user.id,
        folder: "closet",
        fileName: typeof req.query.fileName === "string" ? req.query.fileName : null,
        contentType,
        buffer
      });

      try {
        const updated = await closetRepository.updateImage(user.id, itemId, uploadedImage.publicUrl);
        if (!updated) {
          if (r2StorageService.isConfigured() && r2StorageService.ownsPublicUrl(uploadedImage.publicUrl)) {
            try {
              await r2StorageService.deleteObject(uploadedImage.publicUrl);
            } catch (cleanupError) {
              console.error("Failed to clean up closet replacement upload.", cleanupError);
            }
          }

          res.status(404).json({ error: "Closet item not found." });
          return;
        }

        if (r2StorageService.isConfigured() && r2StorageService.ownsPublicUrl(item.imageUrl)) {
          try {
            await r2StorageService.deleteObject(item.imageUrl);
          } catch (cleanupError) {
            console.error("Failed to delete replaced closet image.", cleanupError);
          }
        }

        res.json({ item: updated });
      } catch (persistError) {
        if (r2StorageService.isConfigured() && r2StorageService.ownsPublicUrl(uploadedImage.publicUrl)) {
          try {
            await r2StorageService.deleteObject(uploadedImage.publicUrl);
          } catch (cleanupError) {
            console.error("Failed to clean up closet replacement upload.", cleanupError);
          }
        }

        throw persistError;
      }
    } catch (error) {
      if (error instanceof ImageModerationRejectedError) {
        console.warn("Closet replacement upload rejected by SafeSearch.", {
          findings: error.findings,
          annotation: error.annotation
        });
        res.status(422).json({ error: error.message });
        return;
      }

      if (error instanceof ImageModerationUnavailableError) {
        console.error("Closet replacement upload blocked because moderation is unavailable.", error.cause);
        res.status(503).json({ error: error.message });
        return;
      }

      if (error instanceof ClothingPresenceRejectedError) {
        console.warn("Closet replacement upload rejected by Gemini clothing-presence review.", {
          reason: error.reason
        });
        res.status(422).json({ error: error.message });
        return;
      }

      if (error instanceof ClothingPresenceUnavailableError) {
        console.error("Closet replacement upload blocked because clothing-presence review is unavailable.", error.cause);
        res.status(503).json({ error: error.message });
        return;
      }

      console.error("Closet item replace image error:", error);
      res.status(500).json({ error: "Failed to replace closet item image." });
    }
  });

  /**
   * POST /api/closet/items/:id/analyze
   *
   * Fetches the closet item image from R2, runs Gemini extraction, and
   * persists the results to MongoDB. On success, sets analysisStatus to
   * "ready". On extraction failure, sets analysisStatus to "error".
   *
   * Response 200: { item: ClosetItemRecord }
   */
  router.post("/closet/items/:id/analyze", async (req, res): Promise<void> => {
    const user = await requireAuth(req, res);
    if (!user) return;

    if (!geminiExtractionService.isConfigured()) {
      res.status(503).json({ error: "Gemini extraction service is not configured." });
      return;
    }

    const itemId = (req.params.id ?? "").trim();
    if (!itemId) {
      res.status(400).json({ error: "Item ID is required." });
      return;
    }

    const item = await closetRepository.findById(user.id, itemId);
    if (!item) {
      res.status(404).json({ error: "Closet item not found." });
      return;
    }

    const body = (req.body as { mimeType?: unknown } | undefined) ?? {};
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType.trim()
        ? body.mimeType.trim().toLowerCase()
        : "image/jpeg";

    try {
      const extraction = await geminiExtractionService.analyzeClothingImage(item.imageUrl, mimeType);
      const updated = await closetRepository.updateExtraction(user.id, itemId, {
        analysisStatus: "ready",
        analysisError: null,
        name: extraction.name,
        category: extraction.category,
        tags: extraction.tags,
        description: extraction.description
      });
      res.json({ item: updated });
    } catch (extractionError) {
      console.error("Gemini analyze error:", extractionError);
      const errorMessage =
        extractionError instanceof Error ? extractionError.message : "Unknown extraction error.";
      await closetRepository.updateExtraction(user.id, itemId, {
        analysisStatus: "error",
        analysisError: errorMessage
      });
      res.status(500).json({ error: "Failed to analyze clothing item." });
    }
  });

  /**
   * POST /api/closet/recommend
   *
   * Builds an outfit by combining user-selected anchor items with
   * Gemini-chosen complementary items from the user's ready wardrobe.
   * Results are ephemeral — nothing is written to MongoDB.
   *
   * Request body: { selectedItemIds: string[] }  (1–5 IDs)
   * Response 200: { outfit: OutfitItem[] }
   */
  router.post("/closet/recommend", async (req, res): Promise<void> => {
    try {
      // 1. Authenticate
      const user = await requireAuth(req, res);
      if (!user) return;

      // 2. Validate request body
      const body = (req.body as { selectedItemIds?: unknown } | undefined) ?? {};
      const rawIds = body.selectedItemIds;

      if (!Array.isArray(rawIds)) {
        res.status(400).json({ error: "selectedItemIds is required and must be an array." });
        return;
      }

      const selectedItemIds = rawIds.map((id) => (typeof id === "string" ? id.trim() : ""));

      if (
        selectedItemIds.length < 1 ||
        selectedItemIds.length > 5 ||
        selectedItemIds.some((id) => !id)
      ) {
        res.status(400).json({ error: "selectedItemIds must contain 1 to 5 non-empty string IDs." });
        return;
      }

      if (new Set(selectedItemIds).size !== selectedItemIds.length) {
        res.status(400).json({ error: "selectedItemIds must not contain duplicates." });
        return;
      }

      // 3. Fetch and validate selected items
      const selectedRecords = await Promise.all(
        selectedItemIds.map((id) => closetRepository.findById(user.id, id))
      );

      if (selectedRecords.some((item) => !item)) {
        res.status(422).json({ error: "One or more selected items were not found." });
        return;
      }

      const selectedReadyItems = selectedRecords
        .map((item) => toReadyClosetItem(item!))
        .filter((item): item is ReadyClosetItem => item !== null);

      if (selectedReadyItems.length !== selectedRecords.length) {
        res.status(422).json({
          error: "All selected items must have analysisStatus 'ready' with category, name, and description."
        });
        return;
      }

      const categoryCount = new Map<string, number>();
      for (const item of selectedReadyItems) {
        categoryCount.set(item.category, (categoryCount.get(item.category) ?? 0) + 1);
      }
      const duplicatedCategory = [...categoryCount.entries()].find(([, count]) => count > 1)?.[0];
      if (duplicatedCategory) {
        res.status(400).json({
          error: `Only one item per category is allowed. Multiple items submitted for category: '${duplicatedCategory}'.`
        });
        return;
      }

      // 4. Build the outfit starting with user-selected anchor items
      const outfit: RecommendOutfitResponse["outfit"] = selectedReadyItems.map((item) => ({
        id: item.id,
        category: item.category,
        name: item.name,
        imageUrl: item.imageUrl,
        tags: item.tags,
        description: item.description,
        isUserSelected: true,
        reason: null
      }));

      // 5. Determine missing categories
      const coveredCategories = new Set<OutfitCategory>(selectedReadyItems.map((item) => item.category));
      const missingCategories = OUTFIT_CATEGORIES.filter((category) => !coveredCategories.has(category));

      if (missingCategories.length === 0) {
        res.json({
          outfit,
          styleNote: "Your selected pieces already form a complete outfit."
        } satisfies RecommendOutfitResponse);
        return;
      }

      // 6. Build candidate pool for missing categories from the user's wardrobe
      const selectedIdSet = new Set(selectedItemIds);
      const allWardrobe = await closetRepository.listByUser(user.id, 1_000);
      const readyWardrobe = allWardrobe
        .map((item) => toReadyClosetItem(item))
        .filter((item): item is ReadyClosetItem => item !== null)
        .filter((item) => !selectedIdSet.has(item.id));

      const candidatesByCategory: Partial<Record<OutfitCategory, ReadyClosetItem[]>> = {};
      for (const category of missingCategories) {
        const candidates = readyWardrobe.filter((item) => item.category === category);
        if (candidates.length > 0) {
          candidatesByCategory[category] = candidates;
        }
      }

      const categoriesToRecommend = missingCategories.filter(
        (category) => (candidatesByCategory[category] ?? []).length > 0
      );

      if (categoriesToRecommend.length === 0) {
        // No candidates exist for any missing category — return with anchor items only
        res.json({
          outfit,
          styleNote: "A cohesive outfit built around your selected pieces."
        } satisfies RecommendOutfitResponse);
        return;
      }

      // 7. Check Gemini is available
      if (!geminiRecommendationService.isConfigured()) {
        res.status(503).json({ error: "Gemini recommendation service is not configured." });
        return;
      }

      // 8. Call Gemini for structured recommendation
      const recommendationCandidates: Partial<Record<OutfitCategory, RecommendationItemContext[]>> = {};
      for (const category of categoriesToRecommend) {
        recommendationCandidates[category] = (candidatesByCategory[category] ?? []).map(
          toRecommendationContext
        );
      }

      const geminiResult = await geminiRecommendationService.recommendOutfit({
        selectedItems: selectedReadyItems.map(toRecommendationContext),
        missingCategories: categoriesToRecommend,
        candidatesByCategory: recommendationCandidates
      });

      // 9. Validate Gemini output (hallucination guard) and resolve final items
      const candidateIdSet = new Set<string>(
        categoriesToRecommend.flatMap((category) => (candidatesByCategory[category] ?? []).map((c) => c.id))
      );
      const categorySet = new Set(categoriesToRecommend);
      const finalizedByCategory = new Map<OutfitCategory, { item: ReadyClosetItem; reason: string }>();

      for (const rec of geminiResult.recommendations) {
        if (!categorySet.has(rec.category)) continue;
        if (finalizedByCategory.has(rec.category)) continue;
        if (!candidateIdSet.has(rec.itemId)) continue;

        const matched = (candidatesByCategory[rec.category] ?? []).find((c) => c.id === rec.itemId);
        if (!matched) continue;

        finalizedByCategory.set(rec.category, {
          item: matched,
          reason: rec.reason.trim() || "Recommended to complete your outfit."
        });
      }

      // 10. Fallback: fill any category that Gemini failed to recommend
      for (const category of categoriesToRecommend) {
        if (finalizedByCategory.has(category)) continue;

        const fallback = candidatesByCategory[category]?.[0];
        if (!fallback) continue;

        finalizedByCategory.set(category, {
          item: fallback,
          reason: "Recommended to complete your outfit."
        });
      }

      // 11. Append AI-recommended items in stable category order
      for (const category of categoriesToRecommend) {
        const entry = finalizedByCategory.get(category);
        if (!entry) continue;

        outfit.push({
          id: entry.item.id,
          category: entry.item.category,
          name: entry.item.name,
          imageUrl: entry.item.imageUrl,
          tags: entry.item.tags,
          description: entry.item.description,
          isUserSelected: false,
          reason: entry.reason
        });
      }

      const styleNote = geminiResult.styleNote.trim() || "A cohesive outfit built around your selected pieces.";
      res.json({ outfit, styleNote } satisfies RecommendOutfitResponse);
    } catch (error) {
      console.error("Closet recommendation error:", error);
      res.status(500).json({ error: "Failed to generate outfit recommendation." });
    }
  });

  return router;
}
