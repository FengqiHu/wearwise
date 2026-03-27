import OpenAI from "openai";
import { z } from "zod";
import type { ChatRole } from "../types/domain.js";
import { CurrentTimeService } from "./current-time-service.js";
import { OpenWeatherService } from "./openweather-service.js";
import { UserLocationService, type BrowserLocation } from "./user-location-service.js";

interface ModelInputMessage {
  role: ChatRole | "system";
  content: string;
}

interface StreamChatInput {
  messages: ModelInputMessage[];
  onChunk: (chunk: string) => void;
  signal?: AbortSignal;
  userLocation?: BrowserLocation;
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
    "When the user asks for live weather, current conditions, rain, snow, temperature, or any forecast, use the get_weather tool instead of answering from memory.",
    "If the user uses a relative date such as today or tomorrow, convert it to an exact YYYY-MM-DD date before calling the tool.",
    "Use mode=current for current conditions and mode=forecast for future dates.",
    "When the user asks for a forecast, use the get_current_time and get_user_location tool to get user's local time and location if the user doesn't specify a location for the forecast. This will help you provide a more accurate forecast.",
    "If the user provides a location name without a country code and the location is ambiguous, just use the location you think is most likely based on the conversation history. Do not ask the user to clarify.",
    "If the tool returns ok=false, explain the tool error plainly. If candidates are included, ask the user to pick one of them.",
    "Never say that you do not have live internet access when the weather tool can answer the request.",
    "When recommending outfits, always fetch live weather first using get_weather (and get_user_location if the user has not specified a location) so the recommendations account for actual temperature and conditions.",
  ].join(" ");
}

export class ChatService {
  private readonly client: OpenAI | null;
  private readonly openWeatherService: OpenWeatherService;
  private readonly currentTimeService: CurrentTimeService;
  private readonly userLocationService: UserLocationService;

  constructor(apiKey: string, openWeatherService: OpenWeatherService) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.openWeatherService = openWeatherService;
    this.currentTimeService = new CurrentTimeService();
    this.userLocationService = new UserLocationService(openWeatherService);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async streamChat(input: StreamChatInput): Promise<string> {
    if (!this.client) {
      throw new Error("OPENAI_API_KEY is not configured on server.");
    }

    const allMessages = input.messages
      .map((message) => ({
        role: message.role,
        content: message.content.trim()
      }))
      .filter((message) => message.content.length > 0);

    // Keep system messages (wardrobe context) always present; slice only conversation history
    const systemMessages = allMessages.filter((m) => m.role === "system");
    const conversationMessages = allMessages.filter((m) => m.role !== "system").slice(-24);
    const nonEmptyMessages = [...systemMessages, ...conversationMessages];

    if (nonEmptyMessages.length === 0) {
      throw new Error("At least one message is required for chat completion.");
    }

    const userLocation = input.userLocation;

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
          },
          {
            type: "function",
            function: {
              name: "get_current_time",
              description:
                "Returns the current date and time. Optionally accepts an IANA timezone name to get the local time for a specific location.",
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  timezone: {
                    type: "string",
                    description: "IANA timezone name, for example America/New_York or Europe/London. Defaults to UTC if omitted."
                  }
                },
                required: []
              },
              parse: (rawArguments: string) => JSON.parse(rawArguments) as { timezone?: string },
              function: (args: { timezone?: string }) => {
                return this.currentTimeService.executeTool(JSON.stringify(args));
              }
            }
          },
          {
            type: "function",
            function: {
              name: "get_user_location",
              description:
                "Returns the approximate location of the user based on their IP address, including city, region, country, and timezone.",
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {},
                required: []
              },
              parse: (_rawArguments: string) => ({}),
              function: async (_args: Record<string, never>) => {
                try {
                  return await this.userLocationService.executeTool(userLocation, input.signal);
                } catch (error) {
                  return {
                    ok: false,
                    error: error instanceof Error ? error.message : "Location lookup failed."
                  };
                }
              }
            }
          }
        ]
      });
    const requestOptions = input.signal
      ? {
          signal: input.signal
        }
      : undefined;

    runner.on("content", (content) => {
      assistantText += content;
      input.onChunk(content);
    });

    await runner.done();

    return assistantText;
  }
}
