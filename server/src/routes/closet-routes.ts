import { Router } from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { AuthService } from "../services/auth-service.js";
import type { GeminiExtractionService } from "../services/gemini-extraction-service.js";
import { isAllowedMimeType, R2StorageService } from "../services/r2-storage-service.js";

interface ClosetRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  r2StorageService: R2StorageService;
  geminiExtractionService: GeminiExtractionService;
}

export function createClosetRoutes({ authService, closetRepository, r2StorageService, geminiExtractionService }: ClosetRoutesDependencies): Router {
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

      if (r2StorageService.isConfigured()) {
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

  return router;
}
