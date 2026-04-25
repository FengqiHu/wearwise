import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImageModerationRejectedError,
  ImageModerationService,
  ImageModerationUnavailableError
} from "./image-moderation-service.js";

function makeSafeAnnotation() {
  return {
    adult: "VERY_UNLIKELY" as const,
    spoof: "VERY_UNLIKELY" as const,
    medical: "VERY_UNLIKELY" as const,
    violence: "VERY_UNLIKELY" as const,
    racy: "VERY_UNLIKELY" as const
  };
}

function makeVisionResponse(
  annotation: object | null = makeSafeAnnotation(),
  error?: string
) {
  return {
    responses: [
      {
        ...(annotation ? { safeSearchAnnotation: annotation } : {}),
        ...(error ? { error: { message: error } } : {})
      }
    ]
  };
}

function makeFetchResponse(ok: boolean, data: unknown, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data)
  } as unknown as Response;
}

describe("ImageModerationService", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured()", () => {
    it("returns false when apiKey is empty", () => {
      const service = new ImageModerationService({ apiKey: "" });
      expect(service.isConfigured()).toBe(false);
    });

    it("returns false when apiKey is only whitespace", () => {
      const service = new ImageModerationService({ apiKey: "   " });
      expect(service.isConfigured()).toBe(false);
    });

    it("returns true when apiKey is non-empty", () => {
      const service = new ImageModerationService({ apiKey: "my-api-key" });
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe("reviewImage()", () => {
    it("returns annotation when image passes all checks", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      const annotation = makeSafeAnnotation();
      mockFetch.mockResolvedValue(makeFetchResponse(true, makeVisionResponse(annotation)));

      const result = await service.reviewImage(Buffer.from("test-image"));

      expect(result).toEqual(annotation);
    });

    it("sends the image as base64 in the request body", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(true, makeVisionResponse()));

      const buffer = Buffer.from("hello image bytes");
      await service.reviewImage(buffer);

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        requests: Array<{ image: { content: string } }>;
      };
      expect(body.requests[0].image.content).toBe(buffer.toString("base64"));
    });

    it("includes SAFE_SEARCH_DETECTION feature in request", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(true, makeVisionResponse()));

      await service.reviewImage(Buffer.from("test"));

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        requests: Array<{ features: Array<{ type: string }> }>;
      };
      expect(body.requests[0].features).toContainEqual({ type: "SAFE_SEARCH_DETECTION" });
    });

    it("calls the Vision API URL", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(true, makeVisionResponse()));

      await service.reviewImage(Buffer.from("test"));

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("vision.googleapis.com");
    });

    it("sends the api key in the x-goog-api-key header", async () => {
      const service = new ImageModerationService({ apiKey: "my-test-api-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(true, makeVisionResponse()));

      await service.reviewImage(Buffer.from("test"));

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((options.headers as Record<string, string>)["x-goog-api-key"]).toBe("my-test-api-key");
    });

    it("throws ImageModerationUnavailableError when not configured", async () => {
      const service = new ImageModerationService({ apiKey: "" });

      await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
        ImageModerationUnavailableError
      );
    });

    it("throws ImageModerationUnavailableError on network error", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockRejectedValue(new Error("Network failure"));

      await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
        ImageModerationUnavailableError
      );
    });

    it("stores the original network error as cause", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      const networkError = new Error("connection refused");
      mockFetch.mockRejectedValue(networkError);

      const error = await service
        .reviewImage(Buffer.from("test"))
        .catch((e) => e as ImageModerationUnavailableError);

      expect(error.cause).toBe(networkError);
    });

    it("throws ImageModerationUnavailableError on non-ok HTTP status", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(false, {}, 403));

      await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
        ImageModerationUnavailableError
      );
    });

    it("throws ImageModerationUnavailableError when response contains an error message", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(
        makeFetchResponse(true, makeVisionResponse(null, "Invalid image content"))
      );

      await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
        ImageModerationUnavailableError
      );
    });

    it("throws ImageModerationUnavailableError when safeSearchAnnotation is missing", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(true, { responses: [{}] }));

      await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
        ImageModerationUnavailableError
      );
    });

    it("throws ImageModerationUnavailableError when responses array is empty", async () => {
      const service = new ImageModerationService({ apiKey: "test-key" });
      mockFetch.mockResolvedValue(makeFetchResponse(true, { responses: [] }));

      await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
        ImageModerationUnavailableError
      );
    });

    describe("policy violations - adult content", () => {
      it("rejects when adult is POSSIBLE", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "POSSIBLE" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
          ImageModerationRejectedError
        );
      });

      it("rejects when adult is LIKELY", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "LIKELY" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
          ImageModerationRejectedError
        );
      });

      it("rejects when adult is VERY_LIKELY", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "VERY_LIKELY" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
          ImageModerationRejectedError
        );
      });

      it("allows when adult is UNLIKELY", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "UNLIKELY" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).resolves.toBeDefined();
      });

      it("includes 'adult' label in findings", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "LIKELY" }))
        );

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.findings).toContain("adult");
      });
    });

    describe("policy violations - violence", () => {
      it("rejects when violence is POSSIBLE", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), violence: "POSSIBLE" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
          ImageModerationRejectedError
        );
      });

      it("rejects when violence is LIKELY", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), violence: "LIKELY" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
          ImageModerationRejectedError
        );
      });

      it("allows when violence is UNLIKELY", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(
            true,
            makeVisionResponse({ ...makeSafeAnnotation(), violence: "UNLIKELY" })
          )
        );

        await expect(service.reviewImage(Buffer.from("test"))).resolves.toBeDefined();
      });

      it("includes 'violent' label in findings", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), violence: "POSSIBLE" }))
        );

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.findings).toContain("violent");
      });
    });

    describe("policy violations - racy content", () => {
      it("rejects when racy is VERY_LIKELY", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), racy: "VERY_LIKELY" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).rejects.toThrow(
          ImageModerationRejectedError
        );
      });

      it("allows when racy is LIKELY (below VERY_LIKELY threshold)", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), racy: "LIKELY" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).resolves.toBeDefined();
      });

      it("allows when racy is POSSIBLE", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), racy: "POSSIBLE" }))
        );

        await expect(service.reviewImage(Buffer.from("test"))).resolves.toBeDefined();
      });

      it("includes 'sexually suggestive' label in findings", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), racy: "VERY_LIKELY" }))
        );

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.findings).toContain("sexually suggestive");
      });
    });

    describe("multiple policy violations", () => {
      it("includes all violated policy labels in findings", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(
            true,
            makeVisionResponse({ adult: "VERY_LIKELY", violence: "POSSIBLE", racy: "VERY_LIKELY" })
          )
        );

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.findings).toContain("adult");
        expect(error.findings).toContain("violent");
        expect(error.findings).toContain("sexually suggestive");
      });

      it("includes the full annotation on rejected error", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        const annotation = { ...makeSafeAnnotation(), adult: "VERY_LIKELY" as const };
        mockFetch.mockResolvedValue(makeFetchResponse(true, makeVisionResponse(annotation)));

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.annotation).toEqual(annotation);
      });

      it("rejection error message mentions safety policy", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "POSSIBLE" }))
        );

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.message.toLowerCase()).toContain("safety policy");
      });
    });

    describe("error class properties", () => {
      it("ImageModerationRejectedError has correct name", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockResolvedValue(
          makeFetchResponse(true, makeVisionResponse({ ...makeSafeAnnotation(), adult: "POSSIBLE" }))
        );

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationRejectedError);

        expect(error.name).toBe("ImageModerationRejectedError");
      });

      it("ImageModerationUnavailableError has correct name", async () => {
        const service = new ImageModerationService({ apiKey: "test-key" });
        mockFetch.mockRejectedValue(new Error("timeout"));

        const error = await service
          .reviewImage(Buffer.from("test"))
          .catch((e) => e as ImageModerationUnavailableError);

        expect(error.name).toBe("ImageModerationUnavailableError");
      });
    });
  });
});
