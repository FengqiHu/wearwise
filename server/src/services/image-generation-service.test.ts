import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationService } from "./image-generation-service.js";

function makeImageResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "image/jpeg" }
  });
}

describe("ImageGenerationService reliability (#356)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries transient Gemini image generation failures before returning image data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(makeImageResponse()));
    const fakeAi = {
      models: {
        generateContent: vi.fn()
          .mockRejectedValueOnce(new Error("503 temporarily unavailable"))
          .mockResolvedValueOnce({
            candidates: [
              { content: { parts: [{ inlineData: { data: Buffer.from("generated").toString("base64") } }] } }
            ]
          })
      }
    };
    const service = new ImageGenerationService({
      apiKey: "test-key",
      reliability: { timeoutMs: 100, retryDelayMs: 0 }
    });
    (service as unknown as { ai: typeof fakeAi }).ai = fakeAi;

    const result = await service.generateOutfitImage({
      bodyImageUrl: "https://cdn.example.com/body.jpg",
      clothingImageUrls: ["https://cdn.example.com/shirt.jpg"]
    });

    expect(result.toString()).toBe("generated");
    expect(fakeAi.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("returns a friendly AI service error when reference image fetching times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    const service = new ImageGenerationService({
      apiKey: "test-key",
      reliability: { timeoutMs: 1, retryDelayMs: 0 }
    });
    (service as unknown as { ai: { models: { generateContent: ReturnType<typeof vi.fn> } } }).ai = {
      models: { generateContent: vi.fn() }
    };

    await expect(service.generateOutfitImage({
      bodyImageUrl: "https://cdn.example.com/body.jpg",
      clothingImageUrls: ["https://cdn.example.com/shirt.jpg"]
    })).rejects.toThrow("AI service is temporarily unavailable");
  });
});
