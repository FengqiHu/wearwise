import { GoogleGenAI } from "@google/genai";

const GENERATION_MODEL = "gemini-2.5-flash-image";

const DEFAULT_PROMPT =
  "Create a realistic full-body photo of this person wearing these clothing items as a complete outfit. " +
  "The photo should look natural, well-lit, and fashion-forward.";

interface ImageGenerationServiceOptions {
  apiKey: string;
}

export class ImageGenerationService {
  private readonly ai: GoogleGenAI | null;

  constructor(options: ImageGenerationServiceOptions) {
    this.ai = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  private async fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${url}: HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const mimeType = (contentType.split(";")[0] ?? "image/jpeg").trim();
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { base64, mimeType };
  }

  async generateOutfitImage(params: {
    bodyImageUrl: string;
    clothingImageUrls: string[];
    promptOverride?: string;
    aspectRatio?: string;
  }): Promise<Buffer> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    const { bodyImageUrl, clothingImageUrls, promptOverride, aspectRatio = "3:4" } = params;

    const bodyImage = await this.fetchImageAsBase64(bodyImageUrl);
    const clothingImages = await Promise.all(clothingImageUrls.map((url) => this.fetchImageAsBase64(url)));

    const parts: object[] = [
      { text: promptOverride ?? DEFAULT_PROMPT },
      { inlineData: { mimeType: bodyImage.mimeType, data: bodyImage.base64 } },
      ...clothingImages.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.base64 }
      }))
    ];

    const response = await this.ai.models.generateContent({
      model: GENERATION_MODEL,
      contents: [{ parts }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio }
      }
    });

    const candidates = response.candidates ?? [];
    if (candidates.length === 0) {
      throw new Error("Gemini returned no candidates.");
    }

    for (const part of candidates[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }

    throw new Error("Gemini response contained no image data.");
  }
}
