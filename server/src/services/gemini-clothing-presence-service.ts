import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

const CLOTHING_PRESENCE_PROMPT =
  "Review this image for WearWise before it is added to a clothing closet. Determine whether the image clearly contains at least one clothing item, top, pant, outwear, shoes, or wearable accessory. " +
  "Reject images that contain no wearable item, only people without visible clothing focus, animals, empty scenes, documents, screenshots, food, furniture, or unrelated objects. Return JSON only.";

const clothingPresenceSchema = z.object({
  hasClothing: z.boolean().describe("True only when at least one wearable clothing item or accessory is clearly visible."),
  reason: z.string().describe("Short reason for the decision.")
});

export class ClothingPresenceRejectedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("This image could not be uploaded because no clothing item was detected. Please choose a photo with clothing clearly visible.");
    this.name = "ClothingPresenceRejectedError";
    this.reason = reason;
  }
}

export class ClothingPresenceUnavailableError extends Error {
  readonly cause: unknown;

  constructor(message = "Clothing image review is temporarily unavailable. Please try uploading again later.", cause?: unknown) {
    super(message);
    this.name = "ClothingPresenceUnavailableError";
    this.cause = cause;
  }
}

interface GeminiClothingPresenceServiceOptions {
  apiKey: string;
}

export class GeminiClothingPresenceService {
  private readonly ai: GoogleGenAI | null;

  constructor(options: GeminiClothingPresenceServiceOptions) {
    this.ai = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async assertClothingPresent(buffer: Buffer, mimeType: string): Promise<void> {
    if (!this.ai) {
      throw new ClothingPresenceUnavailableError();
    }

    const _traceId = crypto.randomUUID().slice(0, 8);
    const _t0 = Date.now();
    try {
      const response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            parts: [
              { inlineData: { data: buffer.toString("base64"), mimeType } },
              { text: CLOTHING_PRESENCE_PROMPT }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(clothingPresenceSchema)
        }
      });

      const parsed = clothingPresenceSchema.parse(JSON.parse(response.text ?? ""));

      if (!parsed.hasClothing) {
        console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "assertClothingPresent", model: GEMINI_MODEL, latencyMs: Date.now() - _t0, ok: false, hasClothing: false, error: "clothing_not_detected" }));
        throw new ClothingPresenceRejectedError(parsed.reason);
      }

      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "assertClothingPresent", model: GEMINI_MODEL, latencyMs: Date.now() - _t0, ok: true, hasClothing: true }));
    } catch (error) {
      if (error instanceof ClothingPresenceRejectedError) {
        throw error;
      }

      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "assertClothingPresent", model: GEMINI_MODEL, latencyMs: Date.now() - _t0, ok: false, error: String(error) }));
      throw new ClothingPresenceUnavailableError(undefined, error);
    }
  }
}
