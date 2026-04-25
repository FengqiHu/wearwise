import { describe, expect, it, vi } from "vitest";
import {
  ImageModerationRejectedError,
  ImageModerationUnavailableError
} from "./image-moderation-service.js";
import type { ImageModerationService } from "./image-moderation-service.js";
import type { R2StorageService } from "./r2-storage-service.js";
import {
  normalizeManagedUploadFolder,
  ReviewedImageStorageService
} from "./reviewed-image-storage-service.js";

function makeR2StorageService(configured = true): R2StorageService {
  return {
    isConfigured: vi.fn().mockReturnValue(configured),
    uploadBuffer: vi.fn().mockResolvedValue("https://cdn.example.com/user-1/closet/uuid-test.jpg")
  } as unknown as R2StorageService;
}

function makeImageModerationService(configured = true): ImageModerationService {
  return {
    isConfigured: vi.fn().mockReturnValue(configured),
    reviewImage: vi.fn().mockResolvedValue({
      adult: "VERY_UNLIKELY",
      violence: "VERY_UNLIKELY",
      racy: "VERY_UNLIKELY"
    })
  } as unknown as ImageModerationService;
}

function getUploadBufferSpy(r2: R2StorageService) {
  return (r2 as unknown as { uploadBuffer: ReturnType<typeof vi.fn> }).uploadBuffer;
}

function getReviewImageSpy(moderation: ImageModerationService) {
  return (moderation as unknown as { reviewImage: ReturnType<typeof vi.fn> }).reviewImage;
}

describe("ReviewedImageStorageService", () => {
  describe("isConfigured()", () => {
    it("returns true when both r2 and moderation services are configured", () => {
      const service = new ReviewedImageStorageService(
        makeR2StorageService(true),
        makeImageModerationService(true)
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("returns false when r2 is not configured", () => {
      const service = new ReviewedImageStorageService(
        makeR2StorageService(false),
        makeImageModerationService(true)
      );
      expect(service.isConfigured()).toBe(false);
    });

    it("returns false when moderation is not configured", () => {
      const service = new ReviewedImageStorageService(
        makeR2StorageService(true),
        makeImageModerationService(false)
      );
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe("storeUserImage()", () => {
    it("returns key and publicUrl on success", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);

      const result = await service.storeUserImage({
        userId: "user-1",
        folder: "closet",
        fileName: "shirt.jpg",
        contentType: "image/jpeg",
        buffer: Buffer.from("image-data")
      });

      expect(result).toHaveProperty("key");
      expect(result).toHaveProperty("publicUrl");
      expect(result.publicUrl).toBe("https://cdn.example.com/user-1/closet/uuid-test.jpg");
    });

    it("key starts with userId and folder", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);

      const result = await service.storeUserImage({
        userId: "user-42",
        folder: "avatar",
        contentType: "image/png",
        buffer: Buffer.from("image-data")
      });

      expect(result.key).toMatch(/^user-42\/avatar\//);
    });

    it("calls reviewImage before uploadBuffer", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);

      const callOrder: string[] = [];
      getReviewImageSpy(moderation).mockImplementation(async () => {
        callOrder.push("reviewImage");
        return {};
      });
      getUploadBufferSpy(r2).mockImplementation(async () => {
        callOrder.push("uploadBuffer");
        return "https://cdn.example.com/key";
      });

      await service.storeUserImage({
        userId: "user-1",
        folder: "closet",
        contentType: "image/jpeg",
        buffer: Buffer.from("image-data")
      });

      expect(callOrder).toEqual(["reviewImage", "uploadBuffer"]);
    });

    it("passes the buffer to reviewImage", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);
      const buffer = Buffer.from("specific-image-bytes");

      await service.storeUserImage({
        userId: "user-1",
        folder: "closet",
        contentType: "image/jpeg",
        buffer
      });

      expect(getReviewImageSpy(moderation)).toHaveBeenCalledWith(buffer);
    });

    it("passes key, buffer, and contentType to uploadBuffer", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);
      const buffer = Buffer.from("image-data");

      const result = await service.storeUserImage({
        userId: "user-1",
        folder: "closet",
        contentType: "image/jpeg",
        buffer
      });

      expect(getUploadBufferSpy(r2)).toHaveBeenCalledWith(result.key, buffer, "image/jpeg");
    });

    it("sanitizes path traversal sequences from fileName", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);

      const result = await service.storeUserImage({
        userId: "user-1",
        folder: "closet",
        fileName: "../../etc/passwd.jpg",
        contentType: "image/jpeg",
        buffer: Buffer.from("image-data")
      });

      expect(result.key).not.toContain("..");
      expect(result.key).not.toContain("/etc/");
    });

    it("uses fallback filename when fileName is null", async () => {
      const r2 = makeR2StorageService();
      const moderation = makeImageModerationService();
      const service = new ReviewedImageStorageService(r2, moderation);

      const result = await service.storeUserImage({
        userId: "user-1",
        folder: "closet",
        fileName: null,
        contentType: "image/jpeg",
        buffer: Buffer.from("image-data")
      });

      expect(result.key).toContain("upload");
    });

    describe("input validation", () => {
      it("throws when contentType is not an allowed MIME type", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);

        await expect(
          service.storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/gif",
            buffer: Buffer.from("image-data")
          })
        ).rejects.toThrow(/image\/gif/);
      });

      it("throws when buffer is empty", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);

        await expect(
          service.storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/jpeg",
            buffer: Buffer.alloc(0)
          })
        ).rejects.toThrow();
      });

      it("does not call uploadBuffer when validation fails", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);

        await service
          .storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/gif",
            buffer: Buffer.from("image-data")
          })
          .catch(() => {});

        expect(getUploadBufferSpy(r2)).not.toHaveBeenCalled();
      });

      it("does not call reviewImage when validation fails", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);

        await service
          .storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/gif",
            buffer: Buffer.from("image-data")
          })
          .catch(() => {});

        expect(getReviewImageSpy(moderation)).not.toHaveBeenCalled();
      });
    });

    describe("moderation errors", () => {
      it("propagates ImageModerationRejectedError", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);
        getReviewImageSpy(moderation).mockRejectedValue(
          new ImageModerationRejectedError("Rejected", ["adult"], { adult: "VERY_LIKELY" })
        );

        await expect(
          service.storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/jpeg",
            buffer: Buffer.from("image-data")
          })
        ).rejects.toThrow(ImageModerationRejectedError);
      });

      it("does not call uploadBuffer when moderation rejects", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);
        getReviewImageSpy(moderation).mockRejectedValue(
          new ImageModerationRejectedError("Rejected", ["adult"], {})
        );

        await service
          .storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/jpeg",
            buffer: Buffer.from("image-data")
          })
          .catch(() => {});

        expect(getUploadBufferSpy(r2)).not.toHaveBeenCalled();
      });

      it("propagates ImageModerationUnavailableError", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);
        getReviewImageSpy(moderation).mockRejectedValue(
          new ImageModerationUnavailableError("Service unavailable")
        );

        await expect(
          service.storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/jpeg",
            buffer: Buffer.from("image-data")
          })
        ).rejects.toThrow(ImageModerationUnavailableError);
      });

      it("does not call uploadBuffer when moderation is unavailable", async () => {
        const r2 = makeR2StorageService();
        const moderation = makeImageModerationService();
        const service = new ReviewedImageStorageService(r2, moderation);
        getReviewImageSpy(moderation).mockRejectedValue(
          new ImageModerationUnavailableError("Service unavailable")
        );

        await service
          .storeUserImage({
            userId: "user-1",
            folder: "closet",
            contentType: "image/jpeg",
            buffer: Buffer.from("image-data")
          })
          .catch(() => {});

        expect(getUploadBufferSpy(r2)).not.toHaveBeenCalled();
      });
    });
  });

  describe("normalizeManagedUploadFolder()", () => {
    it.each([
      ["avatar", "avatar"],
      ["headshot", "headshot"],
      ["full-body", "full-body"],
      ["fullbody", "full-body"],
      ["closet", "closet"],
      ["AVATAR", "avatar"],
      ["HEADSHOT", "headshot"],
      ["FULL-BODY", "full-body"],
      ["CLOSET", "closet"],
      ["  avatar  ", "avatar"]
    ] as const)("normalizes '%s' to '%s'", (input, expected) => {
      expect(normalizeManagedUploadFolder(input)).toBe(expected);
    });

    it.each([["invalid"], ["profile"], [""], [null], [undefined], [123]])(
      "returns null for invalid input %j",
      (input) => {
        expect(normalizeManagedUploadFolder(input)).toBeNull();
      }
    );
  });
});
