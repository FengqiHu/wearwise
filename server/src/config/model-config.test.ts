import { describe, expect, it } from "vitest";
import { analysisReasoning, resolveModelConfig } from "./model-config.js";

describe("model configuration", () => {
  it("preserves existing defaults", () => {
    expect(resolveModelConfig({})).toEqual({
      chat: "gpt-5-mini", humanPresence: "gpt-5-mini", clothingPresence: "gpt-5-mini",
      clothingExtraction: "gpt-5-mini", styleSummary: "gpt-5-mini",
      outfitRecommendation: "gpt-5-mini", shopRecommendation: "gpt-5-mini",
      moderation: "omni-moderation-latest", imageGeneration: "gpt-image-2.5-sunburst"
    });
  });

  it("prioritizes module overrides over group defaults, and ignores blank values", () => {
    expect(resolveModelConfig({
      OPENAI_ANALYSIS_MODEL: " analysis ", OPENAI_RECOMMENDATION_MODEL: " recommendation ",
      OPENAI_HUMAN_PRESENCE_MODEL: " human ", OPENAI_CLOTHING_PRESENCE_MODEL: " ",
      OPENAI_CLOTHING_EXTRACTION_MODEL: "extraction", OPENAI_STYLE_SUMMARY_MODEL: "style",
      OPENAI_SHOP_RECOMMENDATION_MODEL: "shop", OPENAI_OUTFIT_RECOMMENDATION_MODEL: " ",
      OPENAI_CHAT_MODEL: "chat", OPENAI_MODERATION_MODEL: "moderation", OPENAI_IMAGE_MODEL: "image"
    })).toEqual({
      chat: "chat", humanPresence: "human", clothingPresence: "analysis", clothingExtraction: "extraction",
      styleSummary: "style", outfitRecommendation: "recommendation", shopRecommendation: "shop",
      moderation: "moderation", imageGeneration: "image"
    });
  });

  it("keeps chat, moderation and generation independent of the analysis fallback", () => {
    const config = resolveModelConfig({ OPENAI_ANALYSIS_MODEL: "custom-analysis", OPENAI_RECOMMENDATION_MODEL: " " });
    expect(config.styleSummary).toBe("custom-analysis");
    expect(config.chat).toBe("gpt-5-mini");
    expect(config.moderation).toBe("omni-moderation-latest");
    expect(config.imageGeneration).toBe("gpt-image-2.5-sunburst");
  });

  it.each(["gpt-5", "gpt-5-mini", "gpt-5-nano-2025-08-07"])("preserves minimal reasoning for %s", (model) => {
    expect(analysisReasoning(model)).toEqual({ effort: "minimal" });
  });

  it.each(["gpt-4.1-mini", "gpt-4o", "gpt-5.4", "gpt-6-astra", "custom-model"])("omits a hardcoded reasoning effort for %s", (model) => {
    expect(analysisReasoning(model)).toBeUndefined();
  });
});
