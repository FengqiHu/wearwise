import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { RecommendationItem, RecommendationVote } from "../types/domain.js";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

export const OUTFIT_CATEGORIES = ["tops", "pants", "outerwear", "shoes", "accessories"] as const;
export type OutfitCategory = (typeof OUTFIT_CATEGORIES)[number];

/**
 * Zod schema for Gemini's structured recommendation output.
 * Each entry maps a missing category to a specific candidate item ID
 * with a one-sentence reason.
 */
const recommendationSchema = z.object({
  styleNote: z
    .string()
    .describe("A concise one-sentence note describing the overall vibe or style of the completed outfit."),
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
    "  - Include a styleNote: one sentence describing the overall vibe of the completed outfit.",
    "",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

export interface VotedOutfit {
  outfitName: string;
  items: RecommendationItem[];
  vote: RecommendationVote;
}

function buildStyleSummaryPrompt(votedOutfits: VotedOutfit[]): string {
  const liked = votedOutfits.filter((o) => o.vote === "up");
  const disliked = votedOutfits.filter((o) => o.vote === "down");

  const formatOutfit = (o: VotedOutfit) =>
    `- ${o.outfitName}: ${o.items.map((i) => i.name).join(", ")}`;

  console.log("generate style summary");

  return [
    "You are a fashion analyst. Based on a user's outfit vote history, write a concise style preference note (3-4 sentences max).",
    "Focus on patterns: colors, styles, formality, or item types they consistently like or dislike.",
    "Be specific but brief. Do not list outfits — summarize the underlying preference. ",
    "Write in the first person (I like ...), keeping the text straightforward—avoid introductory or concluding remarks.",
    "Do not judge the preference, such as ' Your style effectively bridges the gap between...'",
    liked.length > 0 ? `Liked outfits:\n${liked.map(formatOutfit).join("\n")}` : "No liked outfits.",
    "",
    disliked.length > 0 ? `Disliked outfits:\n${disliked.map(formatOutfit).join("\n")}` : "No disliked outfits.",
    "",
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

  async summarizeStyle(votedOutfits: VotedOutfit[]): Promise<string> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }
    const response = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ parts: [{ text: buildStyleSummaryPrompt(votedOutfits) }] }]
    });
    return (response.text ?? "").trim();
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
