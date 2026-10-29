import { beforeEach, describe, expect, it, vi } from "vitest";
import convert from "heic-convert";
import { InvalidImageUploadError, normalizeUploadedImage } from "./image-upload-service.js";
import { ReviewedImageStorageService } from "./reviewed-image-storage-service.js";
import type { R2StorageService } from "./r2-storage-service.js";
import type { ImageModerationService } from "./image-moderation-service.js";
import type { GeminiHumanPresenceService } from "./gemini-human-presence-service.js";

vi.mock("heic-convert", () => ({ default: vi.fn() }));

describe("HEIC image uploads", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  beforeEach(() => {
    vi.mocked(convert).mockReset().mockResolvedValue(jpeg);
  });

  it("reviews and stores converted JPEG bytes with the matching MIME type and extension", async () => {
    const uploadBuffer = vi.fn().mockResolvedValue("https://cdn.example.com/photo.jpg");
    const reviewImage = vi.fn().mockResolvedValue({});
    const assertRealHumanPresent = vi.fn().mockResolvedValue(undefined);
    const service = new ReviewedImageStorageService(
      { uploadBuffer } as unknown as R2StorageService,
      { reviewImage } as unknown as ImageModerationService,
      { isConfigured: () => true, assertRealHumanPresent } as unknown as GeminiHumanPresenceService
    );

    const result = await service.storeUserProfileImage({
      userId: "user-1", folder: "headshot", fileName: "IMG_1234.HEIC",
      contentType: "image/heic", buffer: Buffer.from("heic-input")
    });

    expect(reviewImage).toHaveBeenCalledWith(jpeg);
    expect(assertRealHumanPresent).toHaveBeenCalledWith(jpeg, "image/jpeg");
    expect(result.key).toMatch(/img_1234\.jpg$/);
    expect(uploadBuffer).toHaveBeenCalledWith(result.key, jpeg, "image/jpeg");
    expect(reviewImage.mock.invocationCallOrder[0]).toBeLessThan(uploadBuffer.mock.invocationCallOrder[0]!);
  });

  it.each(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"])("accepts %s", async (contentType) => {
    const result = await normalizeUploadedImage({ contentType, buffer: Buffer.from("heic") });
    expect(result.contentType).toBe("image/jpeg");
    expect(result.buffer).toEqual(jpeg);
  });

  it("preserves JPEG uploads without conversion", async () => {
    const input = { contentType: "image/jpeg", buffer: jpeg };
    expect(await normalizeUploadedImage(input)).toBe(input);
    expect(convert).not.toHaveBeenCalled();
  });

  it("returns an actionable validation error for a corrupt HEIC", async () => {
    vi.mocked(convert).mockRejectedValue(new Error("decoder failure"));
    await expect(normalizeUploadedImage({ contentType: "image/heic", buffer: Buffer.from("bad") }))
      .rejects.toThrow(InvalidImageUploadError);
  });
});
