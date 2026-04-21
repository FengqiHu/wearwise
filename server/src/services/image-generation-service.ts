import { GoogleGenAI } from "@google/genai";

const GENERATION_MODEL = "gemini-3.1-flash-image-preview";

const BASE_PROMPT =
  "The first reference image is the user's full-body photo. The second reference image, if present, is the user's headshot photo. The remaining reference images are clothing items. " +
  "Create a photorealistic full-body photo of the exact same person shown in the reference body image, now wearing these clothing items as a complete outfit. " +
  "Preserve the person's identity, face, hairstyle, skin tone, body shape, proportions, and overall appearance. " +
  "Use the headshot photo, when provided, to better preserve the same face and identity. Do not change the person into someone else, do not alter age, ethnicity, facial structure, or gender presentation, and do not invent a different model. " +
  "Use the clothing images only to change the outfit. Keep the result natural, well-lit, and photorealistic — as if taken by a professional photographer in everyday conditions. Do not stylize or fantasize the result.";

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
    headshotImageUrl?: string;
    clothingImageUrls: string[];
    promptOverride?: string;
    aspectRatio?: string;
    backgroundContext?: string;
  }): Promise<Buffer> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    const { bodyImageUrl, headshotImageUrl, clothingImageUrls, promptOverride, aspectRatio = "3:4", backgroundContext } = params;

    const bodyImage = await this.fetchImageAsBase64(bodyImageUrl);
    const headshotImage = headshotImageUrl ? await this.fetchImageAsBase64(headshotImageUrl) : null;
    const clothingImages = await Promise.all(clothingImageUrls.map((url) => this.fetchImageAsBase64(url)));

    const backgroundInstruction = backgroundContext
      ? `Place the person in a background that suits this context: "${backgroundContext}". ` +
        `Match the setting to the occasion and weather — for example, a gym interior for workout outfits, ` +
        `a rainy street or covered outdoor area for rainy weather, an office or professional setting for work occasions, ` +
        `a party or event venue for formal/social occasions. Keep the background realistic and non-distracting.`
      : "Use a clean, neutral, well-lit background.";

    const parts: object[] = [
      { text: promptOverride ?? `${BASE_PROMPT} ${backgroundInstruction}` },
      { inlineData: { mimeType: bodyImage.mimeType, data: bodyImage.base64 } },
      ...(headshotImage
        ? [{ inlineData: { mimeType: headshotImage.mimeType, data: headshotImage.base64 } }]
        : []),
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
