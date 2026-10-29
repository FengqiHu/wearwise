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

  it("retries transient OpenAI image editing failures and preserves all reference images", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(makeImageResponse()));
    const fakeAi = {
      images: {
        edit: vi.fn()
          .mockRejectedValueOnce(new Error("503 temporarily unavailable"))
          .mockResolvedValueOnce({
            data: [{ b64_json: Buffer.from("generated").toString("base64") }]
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
      headshotImageUrl: "https://cdn.example.com/headshot.jpg",
      clothingImageUrls: ["https://cdn.example.com/shirt.jpg"]
    });

    expect(result.toString()).toBe("generated");
    expect(fakeAi.images.edit).toHaveBeenCalledTimes(2);
    expect(fakeAi.images.edit).toHaveBeenLastCalledWith(expect.objectContaining({
      model: "gpt-image-2.5-sunburst", image: expect.any(Array), output_format: "png"
    }));
    expect(fakeAi.images.edit.mock.calls[1]?.[0].image).toHaveLength(3);
  });

  it("returns a friendly AI service error when reference image fetching times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    const service = new ImageGenerationService({
      apiKey: "test-key",
      reliability: { timeoutMs: 1, retryDelayMs: 0 }
    });
    (service as unknown as { ai: { images: { edit: ReturnType<typeof vi.fn> } } }).ai = {
      images: { edit: vi.fn() }
    };

    await expect(service.generateOutfitImage({
      bodyImageUrl: "https://cdn.example.com/body.jpg",
      clothingImageUrls: ["https://cdn.example.com/shirt.jpg"]
    })).rejects.toThrow("AI service is temporarily unavailable");
  });
});
