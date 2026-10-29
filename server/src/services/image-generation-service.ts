import { env } from "../config/env.js";
import crypto from "node:crypto";
import OpenAI, { toFile } from "openai";
import { type AiReliabilityOptions, withAiReliability } from "./ai-reliability.js";

const BASE_PROMPT =
  "The first reference image is the user's full-body photo. The second reference image, if present, is the user's headshot photo. The remaining reference images are clothing items. " +
  "Create a photorealistic full-body photo of the exact same person shown in the reference body image, now wearing these clothing items as a complete outfit. " +
  "Preserve the person's identity, face, hairstyle, skin tone, body shape, proportions, and overall appearance. " +
  "Use the headshot photo, when provided, to better preserve the same face and identity. Do not change the person into someone else, do not alter age, ethnicity, facial structure, or gender presentation, and do not invent a different model. " +
  "Use the clothing images only to change the outfit. Keep the result natural, well-lit, and photorealistic — as if taken by a professional photographer in everyday conditions. Do not stylize or fantasize the result.";

export function buildMainPrompt(params: {
  occasions?: string[];
  weatherSummary?: string | null;
  backgroundContext?: string;
}): string {
  const contextParts: string[] = [];

  if (params.occasions && params.occasions.length > 0) {
    contextParts.push(`The outfit is intended for: ${params.occasions.join(", ")}.`);
  }
  if (params.weatherSummary) {
    contextParts.push(`Weather conditions: ${params.weatherSummary}.`);
  }

  const contextInstruction = contextParts.length > 0
    ? `Context for this outfit — ${contextParts.join(" ")}`
    : "";

  const backgroundInstruction = params.backgroundContext
    ? `Place the person in a background that suits this context: "${params.backgroundContext}". ` +
      `Match the setting to the occasion and weather — for example, a gym interior for workout outfits, ` +
      `a rainy street or covered outdoor area for rainy weather, an office or professional setting for work occasions, ` +
      `a party or event venue for formal/social occasions. Keep the background realistic and non-distracting.`
    : "Use a clean, neutral, well-lit background.";

  return [BASE_PROMPT, contextInstruction, backgroundInstruction].filter(Boolean).join(" ");
}

interface ImageGenerationServiceOptions {
  apiKey: string;
  model?: string;
  reliability?: AiReliabilityOptions;
}

export class ImageGenerationService {
  private readonly ai: OpenAI | null;
  private readonly model: string;
  private readonly reliability: AiReliabilityOptions;

  constructor(options: ImageGenerationServiceOptions) {
    this.model = options.model?.trim() || env.models.imageGeneration;
    this.ai = options.apiKey ? new OpenAI({ apiKey: options.apiKey, maxRetries: 0, timeout: 180_000 }) : null;
    this.reliability = options.reliability ?? {};
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  private async fetchReferenceImage(url: string, index: number) {
    return withAiReliability("Fetch try-on reference image", async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(this.reliability.timeoutMs ?? 30_000) });
      if (!response.ok) throw new Error(`Failed to fetch reference image: HTTP ${response.status}.`);
      const mimeType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0]!.trim();
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      return toFile(Buffer.from(await response.arrayBuffer()), `reference-${index}.${extension}`, { type: mimeType });
    }, this.reliability);
  }

  async generateOutfitImage(params: {
    bodyImageUrl: string;
    headshotImageUrl?: string;
    clothingImageUrls: string[];
    promptOverride?: string;
    aspectRatio?: string;
    backgroundContext?: string;
    occasions?: string[];
    weatherSummary?: string | null;
  }): Promise<Buffer> {
    if (!this.ai) throw new Error("OPENAI_API_KEY is not configured on server.");
    const urls = [params.bodyImageUrl, ...(params.headshotImageUrl ? [params.headshotImageUrl] : []), ...params.clothingImageUrls];
    const images = await Promise.all(urls.map((url, index) => this.fetchReferenceImage(url, index)));
    const prompt = params.promptOverride ?? buildMainPrompt({
      ...(params.occasions ? { occasions: params.occasions } : {}),
      ...(params.weatherSummary ? { weatherSummary: params.weatherSummary } : {}),
      ...(params.backgroundContext ? { backgroundContext: params.backgroundContext } : {})
    });
    const [width = 3, height = 4] = (params.aspectRatio ?? "3:4").split(":").map(Number);
    const size = width === height ? "1024x1024" : width > height ? "1536x1024" : "1024x1536";
    const traceId = crypto.randomUUID().slice(0, 8);
    const startedAt = Date.now();
    const model = this.model;
    try {
      const response = await withAiReliability("OpenAI generateTryOn", () => this.ai!.images.edit({
        model, image: images, prompt, n: 1, size, quality: "medium", output_format: "png"
      }), this.reliability);
      const encoded = response.data?.[0]?.b64_json;
      if (!encoded) throw new Error("OpenAI returned no generated image.");
      console.log(JSON.stringify({ traceId, service: "image-generation", op: "generateTryOn", model, imageCount: images.length, latencyMs: Date.now() - startedAt, ok: true }));
      return Buffer.from(encoded, "base64");
    } catch (error) {
      console.error(JSON.stringify({ traceId, service: "image-generation", op: "generateTryOn", model, latencyMs: Date.now() - startedAt, ok: false, error: String(error) }));
      throw error;
    }
  }
}
