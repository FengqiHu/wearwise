import OpenAI from "openai";
import type { ChatRole } from "../types/domain.js";
import { OpenWeatherService } from "./openweather-service.js";
import { log } from "node:console";

interface ModelInputMessage {
  role: ChatRole | "system";
  content: string;
}

interface StreamChatInput {
  messages: ModelInputMessage[];
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
}

const WEATHER_TOOL_NAME = "get_weather";
// max tool calling rounds to prevent infinite loop
const MAX_TOOL_ROUNDS = 4;

export class ChatService {
  private readonly client: OpenAI | null;
  private readonly openWeatherService: OpenWeatherService | null;

  // check the weather service
  constructor(apiKey: string, openWeatherService?: OpenWeatherService | null) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.openWeatherService = openWeatherService ?? null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  // 
  async streamChat(input: StreamChatInput): Promise<string> {
    // check the chat service, now is the openai
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured on server.");
    }

    // validate and prepare messages, remove empty messages
    // context window is the last 24 messages
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

    const messages = this.buildPromptMessages(nonEmptyMessages);
    const tools = this.getAvailableTools();

    // two modes here:
    // 1. no tool calling, just stream the response
    // 2. tool calling, stream the response until tool call, execute the tool, 
    // then continue to stream the response with tool result, repeat until no tool call or exceed max rounds
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      // model assignment, you can replace it with other model or LLM providor
      // set the request
      const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model: "gpt-5-mini",
        messages,
        ...(tools.length > 0
          ? {
              tools,
              tool_choice: "auto" as const
            }
          : {})
      };
      console.log("Chat completion request:", JSON.stringify(request, null, 2));

      // send the request to LLM
      const completion = await this.client.chat.completions.create(
        request,
        input.signal
          ? {
              signal: input.signal
            }
          : undefined
      );

      const assistantMessage = completion.choices[0]?.message;

      if (!assistantMessage) {
        throw new Error("Chat completion did not return a message.");
      }

      const toolCalls = assistantMessage.tool_calls ?? [];

      // if no tool call, just return the response
      if (toolCalls.length === 0) {
        const assistantText = this.getAssistantText(assistantMessage).trim();

        if (!assistantText) {
          throw new Error("Chat completion returned an empty response.");
        }

        input.onChunk(assistantText);
        return assistantText;
      }

      // put the message to the history but not the tool call result
      // this message will not be presented to user
      messages.push(this.toAssistantToolCallMessage(assistantMessage));

      for (const toolCall of toolCalls) {
        const toolResult = await this.executeToolCall(toolCall, input.signal);
        // put the tool call result to the history
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });
      }
    }

    throw new Error("Chat completion exceeded the maximum number of tool rounds.");
  }

  private buildPromptMessages(
    messages: ModelInputMessage[]
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [
      {
        role: "developer",
        content: this.buildDeveloperPrompt()
      },
      // put the history messages in the context, including user and assistant messages
      ...messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];
  }

  // developer prompt
  private buildDeveloperPrompt(): string {
    const weatherToolEnabled = Boolean(this.openWeatherService?.isConfigured());
    const currentDate = this.getCurrentDateIso();

    return [
      "You are WearWise, an AI stylist inside a wardrobe application.",
      "Respond in the same language as the user.",
      "Give concise, practical answers with clear outfit recommendations when appropriate.",
      "Use the user's supplied weather details directly if they already gave a concrete temperature or condition.",
      "Do not invent live weather, forecasts, or temperatures.",
      weatherToolEnabled
        ? `Today's date is ${currentDate}. Use the get_weather tool when live weather is needed for the answer or for outfit advice, and the user has provided a clear location.`
        : `Today's date is ${currentDate}. Live weather lookup is not configured right now, so if the user needs current weather or a forecast, say that the live weather tool is unavailable.`,
      "If live weather is needed but the user did not give a clear location, ask one brief follow-up question.",
      "If the tool says the location is ambiguous, ask the user to clarify the city, state, or country.",
      "When the user uses relative dates like today or tomorrow, convert them to explicit dates before calling tools."
    ].join(" ");
  }

  private getAvailableTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    if (!this.openWeatherService?.isConfigured()) {
      return [];
    }

    return [
      // Tool 1. Weather tool
      {
        type: "function",
        function: {
          name: WEATHER_TOOL_NAME,
          description:
            "Retrieve live current weather or a 5-day forecast for a specific location. Use this when exact weather matters and the user did not already provide concrete weather details.",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "City or place name, such as 'Boston' or 'New York'."
              },
              stateCode: {
                type: "string",
                description: "Optional state or region code when needed for disambiguation, such as 'MA'."
              },
              countryCode: {
                type: "string",
                description: "Optional ISO 3166-1 alpha-2 country code, such as 'US' or 'CN'."
              },
              mode: {
                type: "string",
                enum: ["current", "forecast"],
                description: "Use 'current' for current weather and 'forecast' for a future date."
              },
              targetDate: {
                type: "string",
                description: "Required for forecast mode. Format: YYYY-MM-DD."
              },
              targetTime: {
                type: "string",
                description: "Optional preferred local time in 24-hour HH:mm format."
              }
            },
            required: ["location", "mode"],
            additionalProperties: false
          }
        }
      }
    ];
  }

  // execute the tool call
  private async executeToolCall(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    signal?: AbortSignal
  ): Promise<unknown> {
    if (toolCall.type !== "function") {
      return {
        ok: false,
        error: `Unsupported tool call type: ${toolCall.type}.`
      };
    }

    // execute the weather tool
    if (toolCall.function.name === WEATHER_TOOL_NAME) {
      if (!this.openWeatherService) {
        return {
          ok: false,
          error: "The weather service is not available."
        };
      }

      // return the weather result
      return this.openWeatherService.executeTool(toolCall.function.arguments, signal);
    }

    return {
      ok: false,
      error: `Unknown tool: ${toolCall.function.name}.`
    };
  }

  private toAssistantToolCallMessage(
    message: OpenAI.Chat.Completions.ChatCompletionMessage
  ): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
    const content = this.getAssistantText(message);

    return {
      role: "assistant",
      content: content || null,
      tool_calls: message.tool_calls ?? []
    };
  }

  private getAssistantText(
    message:
      | OpenAI.Chat.Completions.ChatCompletionMessage
      | OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam
  ): string {
    const content = message.content;

    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .map((part) => {
        if ("text" in part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("");
  }

  private getCurrentDateIso(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
