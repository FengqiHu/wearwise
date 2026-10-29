import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "./chat-service.js";
import { OpenWeatherService } from "./openweather-service.js";
import { GeminiHumanPresenceService } from "./gemini-human-presence-service.js";
import { GeminiClothingPresenceService } from "./gemini-clothing-presence-service.js";
import { GeminiExtractionService } from "./gemini-extraction-service.js";
import { GeminiRecommendationService } from "./gemini-recommendation-service.js";
import { ImageModerationService } from "./image-moderation-service.js";
import { ImageGenerationService } from "./image-generation-service.js";

const { respond, moderate, edit, runTools } = vi.hoisted(() => ({
  respond: vi.fn(), moderate: vi.fn(), edit: vi.fn(), runTools: vi.fn()
}));
vi.mock("../config/env.js", () => ({ env: { models: {
  chat: "chat-model", humanPresence: "human-model", clothingPresence: "clothing-model",
  clothingExtraction: "extraction-model", styleSummary: "style-model",
  outfitRecommendation: "outfit-model", shopRecommendation: "shop-model",
  moderation: "moderation-model", imageGeneration: "image-model"
} } }));
vi.mock("openai", async (importOriginal) => {
  const original = await importOriginal<typeof import("openai")>();
  return { ...original, default: class {
    responses = { create: respond };
    moderations = { create: moderate };
    images = { edit };
    chat = { completions: { runTools } };
  } };
});

describe("per-module model routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respond.mockResolvedValue({ status: "completed", output_text: JSON.stringify({
      hasRealHuman: true, hasClothing: true, reason: "visible", name: "shirt", category: "tops", tags: [],
      description: "cotton shirt", styleNote: "casual", recommendations: [], outfits: [{ styleNote: "casual", selections: [] }]
    }) });
    moderate.mockResolvedValue({ results: [{ flagged: false }] });
    edit.mockResolvedValue({ data: [{ b64_json: "aW1hZ2U=" }] });
    runTools.mockReturnValue({ on: vi.fn(), done: vi.fn().mockResolvedValue(undefined), messages: [] });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }));
  });

  it("routes every module to its own configured model without cross-module overrides", async () => {
    // Even a legacy global override cannot replace an explicit module choice.
    vi.stubEnv("OPENAI_ANALYSIS_MODEL", "must-not-override-modules");
    try {
      await new ChatService("test", new OpenWeatherService("")).streamChat({ messages: [{ role: "user", content: "hi" }], onChunk: vi.fn() });
      await new GeminiHumanPresenceService({ apiKey: "test" }).assertRealHumanPresent(Buffer.from("image"), "image/jpeg");
      await new GeminiClothingPresenceService({ apiKey: "test" }).assertClothingPresent(Buffer.from("image"), "image/jpeg");
      await new GeminiExtractionService({ apiKey: "test" }).analyzeClothingImage("https://cdn.example.com/shirt.jpg", "image/jpeg");
      const recommendations = new GeminiRecommendationService({ apiKey: "test" });
      await recommendations.summarizeStyle([]);
      await recommendations.recommendOutfit({ selectedItems: [], missingCategories: [], candidatesByCategory: {} });
      await recommendations.recommendShopOutfits({ productItem: { id: "1", name: "shirt", category: "tops", tags: [], description: "shirt" }, wardrobeByCategory: {} });
      await new ImageModerationService({ apiKey: "", openaiApiKey: "test" }).reviewImage(Buffer.from("image"));
      await new ImageGenerationService({ apiKey: "test" }).generateOutfitImage({ bodyImageUrl: "https://cdn.example.com/body.jpg", clothingImageUrls: [] });
      expect(runTools.mock.calls[0]?.[0].model).toBe("chat-model");
      expect(respond.mock.calls.map(([request]) => request.model)).toEqual([
        "human-model", "clothing-model", "extraction-model", "style-model", "outfit-model", "shop-model"
      ]);
      expect(respond.mock.calls.every(([request]) => !("reasoning" in request))).toBe(true);
      expect(moderate.mock.calls[0]?.[0].model).toBe("moderation-model");
      expect(edit.mock.calls[0]?.[0].model).toBe("image-model");
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
});
