import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

const HUMAN_PRESENCE_PROMPT =
  "Review this profile image for WearWise. Determine whether the image clearly contains a real human person. " +
  "Reject images that contain only clothing, mannequins, dolls, illustrations, cartoons, animals, objects, empty scenes, " +
  "or images where a real person cannot be confidently identified. Return JSON only.";

const humanPresenceSchema = z.object({
  hasRealHuman: z.boolean().describe("True only when a real human person is clearly visible in the image."),
  reason: z.string().describe("Short reason for the decision.")
});

export class HumanPresenceRejectedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("This profile image could not be uploaded because no real person was detected. Please choose a photo with a real person clearly visible.");
    this.name = "HumanPresenceRejectedError";
    this.reason = reason;
  }
}

export class HumanPresenceUnavailableError extends Error {
  readonly cause: unknown;

  constructor(message = "Profile image review is temporarily unavailable. Please try uploading again later.", cause?: unknown) {
    super(message);
    this.name = "HumanPresenceUnavailableError";
    this.cause = cause;
  }
}

interface GeminiHumanPresenceServiceOptions {
  apiKey: string;
}

export class GeminiHumanPresenceService {
  private readonly ai: GoogleGenAI | null;

  constructor(options: GeminiHumanPresenceServiceOptions) {
    this.ai = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async assertRealHumanPresent(buffer: Buffer, mimeType: string): Promise<void> {
    if (!this.ai) {
      throw new HumanPresenceUnavailableError();
    }

    const _traceId = crypto.randomUUID().slice(0, 8);
    const _t0 = Date.now();
    let responseText = "";

    try {
      const response = await this.ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            parts: [
              { inlineData: { data: buffer.toString("base64"), mimeType } },
              { text: HUMAN_PRESENCE_PROMPT }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(humanPresenceSchema)
        }
      });

      responseText = response.text ?? "";
      const parsed = humanPresenceSchema.parse(JSON.parse(responseText));

      if (!parsed.hasRealHuman) {
        console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "assertRealHumanPresent", model: GEMINI_MODEL, latencyMs: Date.now() - _t0, ok: false, hasRealHuman: false, error: "human_not_detected" }));
        throw new HumanPresenceRejectedError(parsed.reason);
      }

      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "assertRealHumanPresent", model: GEMINI_MODEL, latencyMs: Date.now() - _t0, ok: true, hasRealHuman: true }));
    } catch (error) {
      if (error instanceof HumanPresenceRejectedError) {
        throw error;
      }

      console.log(JSON.stringify({ traceId: _traceId, service: "gemini", op: "assertRealHumanPresent", model: GEMINI_MODEL, latencyMs: Date.now() - _t0, ok: false, error: String(error) }));
      throw new HumanPresenceUnavailableError(undefined, error);
    }
  }
}
