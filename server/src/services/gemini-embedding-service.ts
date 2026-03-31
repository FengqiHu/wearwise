import { GoogleGenAI } from "@google/genai";

const EMBEDDING_MODEL = "text-embedding-004";

interface GeminiEmbeddingServiceOptions {
  apiKey: string;
}

export class GeminiEmbeddingService {
  private readonly ai: GoogleGenAI | null;

  constructor(options: GeminiEmbeddingServiceOptions) {
    this.ai = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.ai !== null;
  }

  async embedText(text: string): Promise<number[]> {
    if (!this.ai) {
      throw new Error("GEMINI_API_KEY is not configured on server.");
    }

    const response = await this.ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text
    });

    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error("Embedding response returned no values.");
    }

    return values;
  }

  buildItemText(item: {
    name: string | null;
    category: string | null;
    tags: string[];
    description: string | null;
  }): string {
    return [item.name, item.category, item.tags.join(" "), item.description]
      .filter(Boolean)
      .join(" ");
  }
}
