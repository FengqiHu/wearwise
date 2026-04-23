import crypto from "node:crypto";
import { isAllowedMimeType, R2StorageService } from "./r2-storage-service.js";
import { ImageModerationService } from "./image-moderation-service.js";

export type ManagedUploadFolder = "avatar" | "headshot" | "full-body" | "closet";

interface StoreReviewedImageParams {
  userId: string;
  folder: ManagedUploadFolder;
  fileName?: string | null;
  contentType: string;
  buffer: Buffer;
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

function sanitizeFileName(rawFileName: string | null | undefined, fallbackExtension: string): string {
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

export function normalizeManagedUploadFolder(rawFolder: unknown): ManagedUploadFolder | null {
  if (typeof rawFolder !== "string") {
    return null;
  }

  const trimmed = rawFolder.trim().toLowerCase();

  if (trimmed === "avatar") {
    return "avatar";
  }

  if (trimmed === "headshot") {
    return "headshot";
  }

  if (trimmed === "full-body" || trimmed === "fullbody") {
    return "full-body";
  }

  if (trimmed === "closet") {
    return "closet";
  }

  return null;
}

export class ReviewedImageStorageService {
  constructor(
    private readonly r2StorageService: R2StorageService,
    private readonly imageModerationService: ImageModerationService
  ) {}

  isConfigured(): boolean {
    return this.r2StorageService.isConfigured() && this.imageModerationService.isConfigured();
  }

  async storeUserImage(params: StoreReviewedImageParams): Promise<{ key: string; publicUrl: string }> {
    if (!isAllowedMimeType(params.contentType)) {
      throw new Error(
        `Invalid content type '${params.contentType}'. Allowed: image/jpeg, image/png, image/webp.`
      );
    }

    if (params.buffer.length === 0) {
      throw new Error("Image upload body is required.");
    }

    await this.imageModerationService.reviewImage(params.buffer);

    const extension = getFileExtension(params.contentType);
    const safeFileName = sanitizeFileName(params.fileName, extension);
    const key = `${params.userId}/${params.folder}/${crypto.randomUUID()}-${safeFileName}`;
    const publicUrl = await this.r2StorageService.uploadBuffer(key, params.buffer, params.contentType);

    return { key, publicUrl };
  }
}
