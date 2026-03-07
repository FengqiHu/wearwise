import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTRACTION_PROMPT =
  "You are a fashion assistant. Analyze this clothing item image and extract structured metadata. " +
  "Provide a short name, category (one of: tops, pants, outerwear, shoes,accessories), descriptive tags " +
  "(colour, material, style, season), and a one or two sentence description of the item.";

export const closetItemExtractionSchema = z.object({
  name: z.string().describe("Short human-readable item name, e.g. 'White Linen Shirt'."),
  category: z
    .enum(["tops", "pants", "outerwear", "shoes","accessories"])
    .describe("Clothing category: tops, pants, outerwear, shoes or accessories."),
  tags: z
    .array(z.string())
    .describe("Descriptive keywords covering colour, material, style, and season."),
  description: z.string().describe("One or two sentence summary of the item."),
});

export type ClosetItemExtraction = z.infer<typeof closetItemExtractionSchema>;

interface GeminiExtractionServiceOptions {
  apiKey: string;
}

export class GeminiExtractionService {
  private readonly ai: GoogleGenAI | null;

  constructor(options: GeminiExtractionServiceOptions) {
    this.ai = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async analyzeClothingImage(imageUrl: string, mimeType: string): Promise<ClosetItemExtraction> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error(
        `Unsupported MIME type: ${mimeType}. Allowed: image/jpeg, image/png, image/webp.`
      );
    }

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image from storage: HTTP ${imageResponse.status}.`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Data = Buffer.from(imageBuffer).toString("base64");

    const response = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: EXTRACTION_PROMPT }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(closetItemExtractionSchema),
      },
    });

    const raw = response.text ?? "";
    return closetItemExtractionSchema.parse(JSON.parse(raw));
  }
}
