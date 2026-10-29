type Environment = Record<string, string | undefined>;

export function resolveModelConfig(source: Environment) {
  const read = (key: string, fallback: string) => source[key]?.trim() || fallback;
  const analysis = read("OPENAI_ANALYSIS_MODEL", "gpt-5-mini");
  const recommendation = read("OPENAI_RECOMMENDATION_MODEL", analysis);

  return {
    chat: read("OPENAI_CHAT_MODEL", "gpt-5-mini"),
    humanPresence: read("OPENAI_HUMAN_PRESENCE_MODEL", analysis),
    clothingPresence: read("OPENAI_CLOTHING_PRESENCE_MODEL", analysis),
    clothingExtraction: read("OPENAI_CLOTHING_EXTRACTION_MODEL", analysis),
    styleSummary: read("OPENAI_STYLE_SUMMARY_MODEL", recommendation),
    outfitRecommendation: read("OPENAI_OUTFIT_RECOMMENDATION_MODEL", recommendation),
    shopRecommendation: read("OPENAI_SHOP_RECOMMENDATION_MODEL", recommendation),
    moderation: read("OPENAI_MODERATION_MODEL", "omni-moderation-latest"),
    imageGeneration: read("OPENAI_IMAGE_MODEL", "gpt-image-2.5-sunburst")
  };
}

// Preserve the current GPT-5 setting without sending it to incompatible models.
export function analysisReasoning(model: string): { effort: "minimal" } | undefined {
  return /^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)
    ? { effort: "minimal" }
    : undefined;
}
