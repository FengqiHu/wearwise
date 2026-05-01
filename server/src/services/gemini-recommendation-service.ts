import crypto from "node:crypto";
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

const shopOutfitsSchema = z.object({
  outfits: z
    .array(
      z.object({
        styleNote: z
          .string()
          .describe("A concise one-sentence note describing the overall vibe of this outfit."),
        selections: z.array(
          z.object({
            category: z
              .enum(OUTFIT_CATEGORIES)
              .describe("The category of the selected wardrobe item."),
            itemId: z
              .string()
              .describe("The exact ID of the selected wardrobe item. Must be from the wardrobe lists."),
            reason: z
              .string()
              .describe("One short sentence explaining why this wardrobe item pairs with the product.")
          })
        ).describe("The wardrobe items selected for this outfit (one per category, not the product's category).")
      })
    )
    .min(1)
    .max(3)
    .describe("1 to 3 distinct outfit suggestions built around the product item.")
});

export type ShopOutfitsResult = z.infer<typeof shopOutfitsSchema>;

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

export function buildRecommendationPrompt(input: RecommendOutfitInput): string {
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

export interface VotedOutfitItem {
  id: string;
  name: string;
  category: string | null;
  tags: string[];
}

export interface VotedOutfit {
  outfitName: string;
  items: VotedOutfitItem[];
  vote: RecommendationVote;
  updatedAt: string;
}

const MAX_VOTE_HISTORY = 20;
// Exponential decay half-life: a vote from 60 days ago counts as half as important
const DECAY_HALF_LIFE_DAYS = 60;
const DECAY_LAMBDA = Math.LN2 / DECAY_HALF_LIFE_DAYS;

export function buildStyleSummaryPrompt(votedOutfits: VotedOutfit[]): string {
  // Take the most recent MAX_VOTE_HISTORY votes (already sorted by updatedAt desc from DB)
  const recent = votedOutfits.slice(0, MAX_VOTE_HISTORY);

  const now = Date.now();

  // Compute exponential decay weights then normalize so the most recent vote = 1.00
  const rawWeights = recent.map((o) => {
    const ageDays = (now - new Date(o.updatedAt).getTime()) / 86_400_000;
    return Math.exp(-DECAY_LAMBDA * Math.max(0, ageDays));
  });
  const maxWeight = rawWeights.length > 0 ? Math.max(...rawWeights) : 1;
  const weighted = recent.map((o, i) => ({ outfit: o, weight: rawWeights[i]! / maxWeight }));

  const liked = weighted.filter((w) => w.outfit.vote === "up");
  const disliked = weighted.filter((w) => w.outfit.vote === "down");

  const formatOutfit = ({ outfit, weight }: { outfit: VotedOutfit; weight: number }) => {
    const itemLines = outfit.items.length > 0
      ? outfit.items.map((i) => {
          const cat = i.category ?? "unknown";
          const tags = i.tags.length > 0 ? ` [${i.tags.join(", ")}]` : "";
          return `    - ${i.name} (${cat})${tags}`;
        }).join("\n")
      : "    (no items available)";
    return `- ${outfit.outfitName} [recency: ${weight.toFixed(2)}]:\n${itemLines}`;
  };

  // console.log("generate style summary");

  return [
    "You are a fashion analyst. Based on a user's outfit vote history, write a concise style preference note (3-4 sentences max).",
    "Each outfit is labeled with a recency score from 0.00 to 1.00 (1.00 = most recent vote). Give more weight to outfits with higher recency scores — they better reflect current preferences.",
    "Focus on patterns: colors, styles, formality, or item types they consistently like or dislike.",
    "Be specific but brief. Do not list outfits — summarize the underlying preference.",
    "Write in the first person (I like ...), keeping the text straightforward—avoid introductory or concluding remarks.",
    "Do not judge the preference, such as 'Your style effectively bridges the gap between...'",
    liked.length > 0 ? `Liked outfits:\n${liked.map(formatOutfit).join("\n")}` : "No liked outfits.",
    "",
    disliked.length > 0 ? `Disliked outfits:\n${disliked.map(formatOutfit).join("\n")}` : "No disliked outfits.",
    "",
  ].join("\n");
}

export function buildShopOutfitsPrompt(input: {
  productItem: RecommendationItemContext;
  wardrobeByCategory: Partial<Record<OutfitCategory, RecommendationItemContext[]>>;
}): string {
  return [
    "You are a professional fashion stylist assistant.",
    "The user is considering buying a new product item. Suggest 1-3 distinct outfit combinations",
    "from their existing wardrobe that pair well with it.",
    "",
    "Product (the new item the user may buy):",
    JSON.stringify(input.productItem, null, 2),
    "",
    "Available wardrobe items by category (only use itemIds from these lists):",
    JSON.stringify(input.wardrobeByCategory, null, 2),
    "",
    "Rules:",
    "  - Select at most one item per category per outfit.",
    `  - The product's category is '${input.productItem.category}' — do NOT add wardrobe items in the same category.`,
    "  - Each outfit suggestion must be distinct (use different wardrobe item combinations).",
    "  - Only use itemIds from the wardrobeByCategory lists provided. Never invent IDs.",
    "  - Provide 1-3 outfit suggestions that best complement the product.",
    "  - Each selection must include a one-sentence reason explaining the pairing.",
    "  - Each outfit must include a one-sentence styleNote describing the overall vibe.",
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
    const prompt = buildStyleSummaryPrompt(votedOutfits);
    const _traceId = crypto.randomUUID().slice(0, 8);
    const _t0 = Date.now();
    let response;
    try {
      response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ parts: [{ text: prompt }] }]
      });
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "summarizeStyle", model: GEMINI_MODEL, promptChars: prompt.length, responseChars: (response.text ?? "").length, latencyMs: Date.now() - _t0, ok: true }));
    } catch (err) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "summarizeStyle", model: GEMINI_MODEL, promptChars: prompt.length, latencyMs: Date.now() - _t0, ok: false, error: String(err) }));
      throw err;
    }
    return (response.text ?? "").trim();
  }

  async recommendShopOutfits(input: {
    productItem: RecommendationItemContext;
    wardrobeByCategory: Partial<Record<OutfitCategory, RecommendationItemContext[]>>;
  }): Promise<ShopOutfitsResult> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    const prompt = buildShopOutfitsPrompt(input);

    const _traceId = crypto.randomUUID().slice(0, 8);
    const _t0 = Date.now();
    let response;
    try {
      response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(shopOutfitsSchema)
        }
      });
    } catch (err) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendShopOutfits", model: GEMINI_MODEL, promptChars: prompt.length, latencyMs: Date.now() - _t0, ok: false, error: String(err) }));
      throw err;
    }

    const raw = response.text ?? "";
    if (!raw.trim()) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendShopOutfits", model: GEMINI_MODEL, promptChars: prompt.length, latencyMs: Date.now() - _t0, ok: false, error: "empty_response" }));
      throw new Error("Gemini returned an empty shop recommendation response.");
    }

    let result;
    try {
      result = shopOutfitsSchema.parse(JSON.parse(raw));
    } catch (err) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendShopOutfits", model: GEMINI_MODEL, promptChars: prompt.length, responseChars: raw.length, latencyMs: Date.now() - _t0, ok: false, error: String(err) }));
      throw err;
    }
    console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendShopOutfits", model: GEMINI_MODEL, promptChars: prompt.length, responseChars: raw.length, latencyMs: Date.now() - _t0, ok: true }));
    return result;
  }

  async recommendOutfit(input: RecommendOutfitInput): Promise<RecommendOutfitResult> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    const _prompt = buildRecommendationPrompt(input);
    const _traceId = crypto.randomUUID().slice(0, 8);
    const _t0 = Date.now();
    let response;
    try {
      response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [{ parts: [{ text: _prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(recommendationSchema)
        }
      });
    } catch (err) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendOutfit", model: GEMINI_MODEL, promptChars: _prompt.length, latencyMs: Date.now() - _t0, ok: false, error: String(err) }));
      throw err;
    }

    const raw = response.text ?? "";
    if (!raw.trim()) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendOutfit", model: GEMINI_MODEL, promptChars: _prompt.length, latencyMs: Date.now() - _t0, ok: false, error: "empty_response" }));
      throw new Error("Gemini returned an empty recommendation response.");
    }

    let result;
    try {
      result = recommendationSchema.parse(JSON.parse(raw));
    } catch (err) {
      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendOutfit", model: GEMINI_MODEL, promptChars: _prompt.length, responseChars: raw.length, latencyMs: Date.now() - _t0, ok: false, error: String(err) }));
      throw err;
    }
    console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "recommendOutfit", model: GEMINI_MODEL, promptChars: _prompt.length, responseChars: raw.length, latencyMs: Date.now() - _t0, ok: true }));
    return result;
  }
}
