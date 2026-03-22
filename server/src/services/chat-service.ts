import OpenAI from "openai";
import type { ChatRole } from "../types/domain.js";

interface ModelInputMessage {
  role: ChatRole | "system";
  content: string;
}

interface StreamChatInput {
  messages: ModelInputMessage[];
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
}

export class ChatService {
  private readonly client: OpenAI | null;

  constructor(apiKey: string) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async streamChat(input: StreamChatInput): Promise<string> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured on server.");
    }

    const nonEmptyMessages = input.messages
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }))
      .filter((message) => message.content.length > 0)
      .slice(-24);

    if (nonEmptyMessages.length === 0) {
      throw new Error("At least one message is required for chat completion.");
    }

    const stream = await this.client.chat.completions.create(
      {
        model: "gpt-5-mini",
        messages: nonEmptyMessages,
        stream: true
      },
      input.signal
        ? {
            signal: input.signal
          }
        : undefined
    );

    let assistantText = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? "";
      if (content) {
        assistantText += content;
        input.onChunk(content);
      }
    }

    return assistantText;
  }
}
