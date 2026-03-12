import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

export const OUTFIT_CATEGORIES = ["tops", "pants", "outerwear", "shoes", "accessories"] as const;
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

/**
 * Zod schema for Gemini's structured recommendation output.
 * Each entry maps a missing category to a specific candidate item ID
 * with a one-sentence reason.
 */
const recommendationSchema = z.object({
  recommendations: z.array(
    z.object({
      category: z
        .enum(OUTFIT_CATEGORIES)
        .describe("The missing outfit category this recommendation fills."),
      itemId: z
        .string()
        .describe("The exact ID of the recommended candidate item. Must be from the candidates list."),
      reason: z
        .string()
        .describe("One short sentence explaining why this item completes the outfit.")
    })
  )
});

export type RecommendOutfitResult = z.infer<typeof recommendationSchema>;

export interface RecommendationItemContext {
  id: string;
  category: OutfitCategory;
  name: string;
  tags: string[];
  description: string;
}

export interface RecommendOutfitInput {
  selectedItems: RecommendationItemContext[];
  missingCategories: OutfitCategory[];
  candidatesByCategory: Partial<Record<OutfitCategory, RecommendationItemContext[]>>;
}

interface GeminiRecommendationServiceOptions {
  apiKey: string;
}

function buildRecommendationPrompt(input: RecommendOutfitInput): string {
  const context = {
    selectedItems: input.selectedItems,
    missingCategories: input.missingCategories,
    candidatesByCategory: input.candidatesByCategory
  };

  return [
    "You are a professional fashion stylist assistant.",
    "Your task: pick exactly one item per missing category to complete the outfit.",
    "Rules:",
    "  - Only use item IDs from the candidatesByCategory list provided.",
    "  - Never invent or modify item IDs.",
    "  - Recommend items that stylistically complement the selected items.",
    "  - Keep each reason to one concise sentence.",
    "",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

export class GeminiRecommendationService {
  private readonly ai: GoogleGenAI | null;

  constructor(options: GeminiRecommendationServiceOptions) {
    this.ai = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async recommendOutfit(input: RecommendOutfitInput): Promise<RecommendOutfitResult> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    const response = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          parts: [{ text: buildRecommendationPrompt(input) }]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(recommendationSchema)
      }
    });

    const raw = response.text ?? "";
    if (!raw.trim()) {
      throw new Error("Gemini returned an empty recommendation response.");
    }

    return recommendationSchema.parse(JSON.parse(raw));
  }
}
