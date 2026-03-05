import { Router } from "express";
import type { ClosetRepository } from "../repositories/closet-repository.js";
import type { AuthService } from "../services/auth-service.js";
import { isAllowedMimeType, R2StorageService } from "../services/r2-storage-service.js";

interface ClosetRoutesDependencies {
  authService: AuthService;
  closetRepository: ClosetRepository;
  r2StorageService: R2StorageService;
}

export function createClosetRoutes({ authService, closetRepository, r2StorageService }: ClosetRoutesDependencies): Router {
  const router = Router();

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

  return router;
}
