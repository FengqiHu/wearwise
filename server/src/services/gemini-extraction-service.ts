import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXTRACTION_PROMPT =
  "You are a fashion assistant. Analyze this clothing item image and describe what you see in detail, " +
  "including the type of clothing, color, material, style, and the season the clothing is suitable for.";

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

  async analyzeClothingImage(imageUrl: string, mimeType: string): Promise<string> {
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
      ]
    });

    return response.text ?? "";
  }
}
