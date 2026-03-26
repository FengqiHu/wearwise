import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Router } from "express";
import { env } from "../config/env.js";
import { AuthService } from "../services/auth-service.js";

interface UploadRoutesDependencies {
  authService: AuthService;
}

function getFileExtension(contentType: string): string {
  const [, subtype = "bin"] = contentType.toLowerCase().split("/");

  if (subtype === "jpeg") {
    return "jpg";
  }

  if (subtype.includes("svg")) {
    return "svg";
  }

  return subtype.replace(/[^a-z0-9]/g, "") || "bin";
}

function normalizeImageKind(rawFolder: unknown): "avatar" | "headshot" | "fullbody" | "closet" {
  if (typeof rawFolder !== "string") {
    return "fullbody";
  }

  const trimmed = rawFolder.trim().toLowerCase();
  if (trimmed === "avatar") {
    return "avatar";
  }

  if (trimmed === "headshot") {
    return "headshot";
  }

  if (trimmed === "closet") {
    return "closet";
  }

  return "fullbody";
}

function sanitizeFileName(rawFileName: unknown, fallbackExtension: string): string {
  if (typeof rawFileName !== "string" || !rawFileName.trim()) {
    return `upload.${fallbackExtension}`;
  }

  const fileNameOnly = rawFileName.split(/[/\\]/).pop() ?? "";
  const trimmed = fileNameOnly.trim();

  if (!trimmed) {
    return `upload.${fallbackExtension}`;
  }

  const lastDot = trimmed.lastIndexOf(".");
  const basePart = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const extPart = lastDot > 0 ? trimmed.slice(lastDot + 1) : fallbackExtension;
  const safeBase = basePart.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const safeExt = extPart.toLowerCase().replace(/[^a-z0-9]/g, "");

  return `${safeBase || "upload"}.${safeExt || fallbackExtension}`;
}

function assertS3Config(): string | null {
  if (!env.s3Bucket || !env.s3AccessKeyId || !env.s3SecretAccessKey || !env.s3PublicBaseUrl) {
    return "S3 upload is not configured on the server.";
  }

  return null;
}

export function createUploadsRoutes({ authService }: UploadRoutesDependencies): Router {
  const router = Router();

  const configError = assertS3Config();

  const s3Client = (() => {
    if (configError !== null) {
      return null;
    }

    const config: ConstructorParameters<typeof S3Client>[0] = {
      region: env.s3Region,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey
      }
    };

    if (env.s3Endpoint) {
      config.endpoint = env.s3Endpoint;
    }

    return new S3Client(config);
  })();

  router.post("/uploads/presign-image", async (req, res): Promise<void> => {
    if (configError || !s3Client) {
      res.status(500).json({ error: configError ?? "S3 upload is not configured on the server." });
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

      const payload = req.body as { contentType?: unknown; folder?: unknown; fileName?: unknown };
      const contentType = typeof payload.contentType === "string" ? payload.contentType.trim().toLowerCase() : "";

      if (!contentType.startsWith("image/")) {
        res.status(400).json({ error: "Invalid image content type." });
        return;
      }

      const imageKind = normalizeImageKind(payload.folder);
      const extension = getFileExtension(contentType);
      const safeFileName = sanitizeFileName(payload.fileName, extension);
      const key = `${authResolution.user.id}/${imageKind}/${safeFileName}`;

      const command = new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        ContentType: contentType
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 * 5 });
      const publicUrl = `${env.s3PublicBaseUrl}/${key}`;

      res.json({
        uploadUrl,
        publicUrl,
        key
      });
    } catch (error) {
      console.error("Presign upload error:", error);
      res.status(500).json({ error: "Failed to prepare image upload." });
    }
  });

  return router;
}
