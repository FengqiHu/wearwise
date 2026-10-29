import convert from "heic-convert";
import { isAllowedMimeType } from "./r2-storage-service.js";

const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export class InvalidImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageUploadError";
  }
}

export function isSupportedUploadMimeType(contentType: string): boolean {
  return isAllowedMimeType(contentType) || HEIC_TYPES.has(contentType);
}

export async function normalizeUploadedImage<T extends {
  buffer: Buffer;
  contentType: string;
  fileName?: string | null;
}>(input: T): Promise<T> {
  if (input.buffer.length === 0) {
    throw new InvalidImageUploadError("Image upload body is required.");
  }
  if (!isSupportedUploadMimeType(input.contentType)) {
    throw new InvalidImageUploadError(`Unsupported image format '${input.contentType}'. Please upload a JPEG, PNG, WebP, HEIC, or HEIF photo.`);
  }
  if (!HEIC_TYPES.has(input.contentType)) {
    return input;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await convert({ buffer: input.buffer, format: "JPEG", quality: 0.9 }));
  } catch {
    throw new InvalidImageUploadError("This HEIC photo could not be converted. Please export it as JPEG or PNG and try again.");
  }

  return {
    ...input,
    buffer,
    contentType: "image/jpeg",
    fileName: `${(input.fileName || "photo").replace(/\.[^.]+$/, "")}.jpg`
  };
}
