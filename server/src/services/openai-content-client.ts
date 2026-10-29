import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses.js";

interface ContentRequest {
  model: string;
  contents: Array<{ parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> }>;
  config?: { responseMimeType?: string; responseJsonSchema?: Record<string, unknown> };
}

/** Preserves the existing services' content contract while using OpenAI Responses. */
export class OpenAIContentClient {
  private readonly client: OpenAI;
  readonly models = { generateContent: (request: ContentRequest) => this.generateContent(request) };

  constructor(options: { apiKey: string }) {
    this.client = new OpenAI({ apiKey: options.apiKey, maxRetries: 0, timeout: 60_000 });
  }

  private async generateContent(request: ContentRequest): Promise<{ text: string }> {
    const content: ResponseInputContent[] = request.contents.flatMap(({ parts }) => parts.flatMap((part): ResponseInputContent[] => {
      if (part.inlineData) {
        return [{ type: "input_image", image_url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, detail: "auto" }];
      }
      return part.text ? [{ type: "input_text", text: part.text }] : [];
    }));
    const schema = request.config?.responseJsonSchema;
    const response = await this.client.responses.create({
      model: process.env.OPENAI_ANALYSIS_MODEL?.trim() || request.model,
      input: [{ role: "user", content }],
      reasoning: { effort: "minimal" },
      store: false,
      ...(schema ? { text: { format: { type: "json_schema", name: "wearwise_result", schema, strict: true } } } : {})
    });
    if (response.status !== "completed" || !response.output_text) {
      throw new Error("OpenAI did not return a complete analysis result.");
    }
    return { text: response.output_text };
  }
}
