import OpenAI from "openai";
import { z } from "zod";
import type { ChatRole } from "../types/domain.js";
import { OpenWeatherService } from "./openweather-service.js";

interface ModelInputMessage {
  role: ChatRole;
  content: string;
}

interface StreamChatInput {
  messages: ModelInputMessage[];
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
}

const CHAT_MODEL = "gpt-5-mini";
const weatherToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    location: {
      type: "string",
      description: "City or location name, for example Baltimore."
    },
    stateCode: {
      type: "string",
      description: "Optional state, province, or region code, for example MD."
    },
    countryCode: {
      type: "string",
      description: "Optional two-letter ISO country code, for example US."
    },
    mode: {
      type: "string",
      enum: ["current", "forecast"],
      description: "Use current for live conditions and forecast for a future date."
    },
    targetDate: {
      type: "string",
      description: "Forecast date in YYYY-MM-DD format. Required when mode is forecast."
    },
    targetTime: {
      type: "string",
      description: "Optional preferred local time in HH:mm for forecast lookups."
    }
  },
  required: ["location"]
};

const weatherToolInputSchema = z
  .object({
    location: z.string().trim().min(1, "location is required."),
    stateCode: z.string().trim().min(1).max(32).optional(),
    countryCode: z.string().trim().length(2).optional(),
    mode: z.enum(["current", "forecast"]).default("current"),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD.").optional(),
    targetTime: z.string().regex(/^\d{2}:\d{2}$/, "targetTime must be HH:mm.").optional()
  })
  .superRefine((input, context) => {
    if (input.mode === "forecast" && !input.targetDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetDate"],
        message: "targetDate is required when mode is forecast."
      });
    }
  });

type WeatherToolArgs = z.infer<typeof weatherToolInputSchema>;

function toIsoLocalDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

function buildDeveloperInstructions(todayIsoDate: string): string {
  return [
    "You are the WearWise assistant.",
    `Today is ${todayIsoDate}.`,
    "When the user asks for live weather, current conditions, rain, snow, temperature, or any forecast, use the get_weather tool instead of answering from memory.",
    "If the user uses a relative date such as today or tomorrow, convert it to an exact YYYY-MM-DD date before calling the tool.",
    "Use mode=current for current conditions and mode=forecast for future dates.",
    "If the user provides a location name without a country code and the location is ambiguous, just use the location you think is most likely based on the conversation history. Do not ask the user to clarify.",
    "If the tool returns ok=false, explain the tool error plainly. If candidates are included, ask the user to pick one of them.",
    "Never say that you do not have live internet access when the weather tool can answer the request."
  ].join(" ");
}

export class ChatService {
  private readonly client: OpenAI | null;
  private readonly openWeatherService: OpenWeatherService;

  constructor(apiKey: string, openWeatherService: OpenWeatherService) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.openWeatherService = openWeatherService;
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

    let assistantText = "";
    const runner = this.client.chat.completions.runTools(
      {
        model: CHAT_MODEL,
        stream: true,
        messages: [
          {
            role: "developer",
            content: buildDeveloperInstructions(toIsoLocalDate(new Date()))
          },
          ...nonEmptyMessages
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description:
                "Fetches live current weather or a forecast from OpenWeather for a city or location. Use this for real weather conditions instead of guessing.",
              parameters: weatherToolParameters,
              parse: (rawArguments: string) => weatherToolInputSchema.parse(JSON.parse(rawArguments)),
              function: async (args: WeatherToolArgs) => {
                try {
                  return await this.openWeatherService.executeTool(JSON.stringify(args), input.signal);
                } catch (error) {
                  return {
                    ok: false,
                    error: error instanceof Error ? error.message : "Weather lookup failed."
                  };
                }
              }
            }
          }
        ]
      },
      input.signal
        ? {
            signal: input.signal
          }
        : undefined
    );

    runner.on("content", (content) => {
      assistantText += content;
      input.onChunk(content);
    });

    await runner.done();

    return assistantText;
  }
}
