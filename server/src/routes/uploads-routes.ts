import express, { Router } from "express";
import { AuthService } from "../services/auth-service.js";
import {
  ImageModerationRejectedError,
  ImageModerationUnavailableError
} from "../services/image-moderation-service.js";
import {
  normalizeManagedUploadFolder,
  ReviewedImageStorageService
} from "../services/reviewed-image-storage-service.js";

interface UploadRoutesDependencies {
  authService: AuthService;
  reviewedImageStorageService: ReviewedImageStorageService;
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

export function createUploadsRoutes({
  authService,
  reviewedImageStorageService
}: UploadRoutesDependencies): Router {
  const router = Router();

  router.post("/uploads/images", rawImageBodyParser, async (req, res): Promise<void> => {
    if (!reviewedImageStorageService.isConfigured()) {
      res.status(503).json({ error: "Image upload is temporarily unavailable. Please try again later." });
      return;
    }

    try {
      const authResolution = await authService.resolveAuthenticatedUser(req);

      if (!authResolution.user || authResolution.error) {
        res.status(authResolution.error?.status ?? 401).json({
          error: authResolution.error?.message ?? "Unauthorized."
        });
        return;
      }

      const contentType = normalizeImageContentType(req.headers["content-type"]);
      if (!contentType.startsWith("image/")) {
        res.status(400).json({ error: "Invalid image content type." });
        return;
      }

      const folder = normalizeManagedUploadFolder(req.query.folder);
      if (!folder || folder === "closet") {
        res.status(400).json({ error: "Invalid upload folder. Allowed: avatar, headshot, full-body." });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: "Image upload body is required." });
        return;
      }

      const fileName = typeof req.query.fileName === "string" ? req.query.fileName : null;
      const uploadedImage = await reviewedImageStorageService.storeUserImage({
        userId: authResolution.user.id,
        folder,
        fileName,
        contentType,
        buffer
      });

      res.status(201).json(uploadedImage);
    } catch (error) {
      if (error instanceof ImageModerationRejectedError) {
        console.warn("Managed image upload rejected by SafeSearch.", {
          findings: error.findings,
          annotation: error.annotation
        });
        res.status(422).json({ error: error.message });
        return;
      }

      if (error instanceof ImageModerationUnavailableError) {
        console.error("Managed image upload blocked because moderation is unavailable.", error.cause);
        res.status(503).json({ error: error.message });
        return;
      }

      console.error("Managed image upload error:", error);
      res.status(500).json({ error: "Failed to upload image." });
    }
  });

  return router;
}
