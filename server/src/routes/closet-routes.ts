import { Router } from "express";
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
import { isAllowedMimeType, R2StorageService } from "../services/r2-storage-service.js";
import type { ClosetItemRecord, RecommendOutfitResponse } from "../types/domain.js";

interface ClosetRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  r2StorageService: R2StorageService;
  geminiExtractionService: GeminiExtractionService;
  geminiRecommendationService: GeminiRecommendationService;
}

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
  geminiExtractionService,
  geminiRecommendationService
}: ClosetRoutesDependencies): Router {
  const router = Router();

  /**
   * GET /api/closet/items
   *
   * Returns the authenticated user's closet items, newest first.
   */
  router.get("/closet/items", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const items = await closetRepository.listByUser(authResolution.user.id);
      res.json({ items });
    } catch (error) {
      console.error("Closet list error:", error);
      res.status(500).json({ error: "Failed to fetch closet items." });
    }
  });

  /**
   * POST /api/closet/items
   *
   * Creates a closet item record and returns a presigned R2 upload URL.
   * The client uses the uploadUrl to PUT the image directly to R2.
   *
   * Request body (JSON): { contentType: string }
   *   - contentType: MIME type of the image (image/jpeg, image/png, image/webp)
   *
   * Response 201: { item: ClosetItemRecord, uploadUrl: string }
   *   - item: the newly created closet item record (analysisStatus: "pending")
   *   - uploadUrl: presigned R2 URL (valid for 5 minutes); client must PUT the file to this URL
   */
  router.post("/closet/items", async (req, res): Promise<void> => {
    try {
      // 1. Authenticate
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      // 2. Guard: storage must be configured
      if (!r2StorageService.isConfigured()) {
        res.status(503).json({ error: "Storage service is not configured." });
        return;
      }

      // 3. Parse and validate request body
      const body = (req.body as { contentType?: unknown } | undefined) ?? {};
      const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";

      if (!contentType) {
        res.status(400).json({ error: "Missing required field: contentType." });
        return;
      }

      if (!isAllowedMimeType(contentType)) {
        res.status(400).json({
          error: `Invalid content type '${contentType}'. Allowed: image/jpeg, image/png, image/webp.`
        });
        return;
      }

      // 4. Generate presigned upload URL and target public URL
      const { uploadUrl, publicUrl } = await r2StorageService.presignClosetImageUpload(
        authResolution.user.id,
        contentType
      );

      // 5. Persist ClosetItem record in MongoDB (imageUrl points to where the file will be)
      const item = await closetRepository.create(authResolution.user.id, publicUrl);

      res.status(201).json({ item, uploadUrl });
    } catch (error) {
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
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const parsed = importClosetItemsRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid import payload." });
        return;
      }

      const imported = await closetRepository.importMany(authResolution.user.id, parsed.data.items);
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
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(authResolution.user.id, itemId);
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
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(authResolution.user.id, itemId);
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

      const updated = await closetRepository.updateMetadata(authResolution.user.id, itemId, update);
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
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(authResolution.user.id, itemId);
      if (!item) {
        res.status(404).json({ error: "Closet item not found." });
        return;
      }

      await closetRepository.deleteById(authResolution.user.id, itemId);

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
   * Replaces the image of a closet item. Deletes the old R2 object, generates a
   * new presigned upload URL, and resets the item's analysisStatus to "pending".
   *
   * Request body (JSON): { contentType: string }
   * Response 200: { item: ClosetItemRecord, uploadUrl: string }
   */
  router.put("/closet/items/:id/image", async (req, res): Promise<void> => {
    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      if (!r2StorageService.isConfigured()) {
        res.status(503).json({ error: "Storage service is not configured." });
        return;
      }

      const itemId = (req.params.id ?? "").trim();
      if (!itemId) {
        res.status(400).json({ error: "Item ID is required." });
        return;
      }

      const item = await closetRepository.findById(authResolution.user.id, itemId);
      if (!item) {
        res.status(404).json({ error: "Closet item not found." });
        return;
      }

      const body = (req.body as { contentType?: unknown } | undefined) ?? {};
      const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";

      if (!contentType) {
        res.status(400).json({ error: "Missing required field: contentType." });
        return;
      }

      if (!isAllowedMimeType(contentType)) {
        res.status(400).json({
          error: `Invalid content type '${contentType}'. Allowed: image/jpeg, image/png, image/webp.`
        });
        return;
      }

      await r2StorageService.deleteObject(item.imageUrl);

      const { uploadUrl, publicUrl } = await r2StorageService.presignClosetImageUpload(
        authResolution.user.id,
        contentType
      );

      const updated = await closetRepository.updateImage(authResolution.user.id, itemId, publicUrl);

      res.json({ item: updated, uploadUrl });
    } catch (error) {
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
    const authResolution = await authService.resolveAuthenticatedUser(req);
    if (!authResolution.user || authResolution.error) {
      res.status(authResolution.error?.status ?? 401).json({
        error: authResolution.error?.message ?? "Unauthorized."
      });
      return;
    }

    if (!geminiExtractionService.isConfigured()) {
      res.status(503).json({ error: "Gemini extraction service is not configured." });
      return;
    }

    const itemId = (req.params.id ?? "").trim();
    if (!itemId) {
      res.status(400).json({ error: "Item ID is required." });
      return;
    }

    const item = await closetRepository.findById(authResolution.user.id, itemId);
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
      const updated = await closetRepository.updateExtraction(authResolution.user.id, itemId, {
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
      await closetRepository.updateExtraction(authResolution.user.id, itemId, {
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
      const authResolution = await authService.resolveAuthenticatedUser(req);
      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const { user } = authResolution;

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
