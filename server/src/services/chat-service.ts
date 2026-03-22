import OpenAI from "openai";
import { zodFunction } from "openai/helpers/zod";
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

const WEATHER_TOOL_NAME = "get_weather";
const CHAT_MODEL = "gpt-5-mini";
const MAX_CONTEXT_MESSAGES = 24;

const weatherToolInputSchema = z
  .object({
    location: z.string().trim().min(1, "location is required."),
    stateCode: z.string().trim().min(1).max(32).nullable(),
    countryCode: z.string().trim().length(2).nullable(),
    mode: z.enum(["current", "forecast"]),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD.").nullable(),
    targetTime: z.string().regex(/^\d{2}:\d{2}$/, "targetTime must be HH:mm.").nullable()
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

function normalizeWeatherToolArgs(args: WeatherToolArgs): {
  location: string;
  mode: "current" | "forecast";
  stateCode?: string;
  countryCode?: string;
  targetDate?: string;
  targetTime?: string;
} {
  return {
    location: args.location,
    mode: args.mode,
    ...(args.stateCode ? { stateCode: args.stateCode } : {}),
    ...(args.countryCode ? { countryCode: args.countryCode } : {}),
    ...(args.targetDate ? { targetDate: args.targetDate } : {}),
    ...(args.targetTime ? { targetTime: args.targetTime } : {})
  };
}

function toIsoLocalDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

function buildDeveloperInstructions(todayIsoDate: string, weatherToolEnabled: boolean): string {
  return [
    "You are WearWise, an AI stylist inside a wardrobe application.",
    "Respond in the same language as the user.",
    "Give concise, practical answers with clear outfit recommendations when appropriate.",
    "Use the user's supplied weather details directly if they already gave a concrete temperature or condition.",
    "Do not invent live weather, forecasts, or temperatures.",
    weatherToolEnabled
      ? `Today's date is ${todayIsoDate}. Use the ${WEATHER_TOOL_NAME} tool when live weather is needed for the answer or for outfit advice, and the user has provided a clear location.`
      : `Today's date is ${todayIsoDate}. Live weather lookup is not configured right now, so if the user needs current weather or a forecast, say that the live weather tool is unavailable.`,
    "If live weather is needed but the user did not give a clear location, ask one brief follow-up question.",
    "If the tool returns ok=false, explain the tool error plainly. If candidates are included, ask the user to pick one of them.",
    "When the user uses relative dates like today or tomorrow, convert them to exact YYYY-MM-DD dates before calling tools."
  ].join(" ");
}

export class ChatService {
  private readonly client: OpenAI | null;
  private readonly openWeatherService: OpenWeatherService | null;

  constructor(apiKey: string, openWeatherService?: OpenWeatherService | null) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.openWeatherService = openWeatherService ?? null;
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
      .slice(-MAX_CONTEXT_MESSAGES);

    if (nonEmptyMessages.length === 0) {
      throw new Error("At least one message is required for chat completion.");
    }

    let assistantText = "";
    const requestMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "developer",
        content: buildDeveloperInstructions(toIsoLocalDate(new Date()), Boolean(this.openWeatherService?.isConfigured()))
      },
      ...nonEmptyMessages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    ];
    const requestOptions = input.signal
      ? {
          signal: input.signal
        }
      : undefined;

    const openWeatherService = this.openWeatherService;

    if (openWeatherService?.isConfigured()) {
      const runner = this.client.chat.completions.runTools(
        {
          model: CHAT_MODEL,
          stream: true,
          messages: requestMessages,
          tools: [
            zodFunction({
              name: WEATHER_TOOL_NAME,
              description:
                "Fetches live current weather or a forecast from OpenWeather for a city or location. Use this for real weather conditions instead of guessing.",
              parameters: weatherToolInputSchema,
              function: async (args: WeatherToolArgs) => {
                try {
                  return await openWeatherService.executeTool(
                    JSON.stringify(normalizeWeatherToolArgs(args)),
                    input.signal
                  );
                } catch (error) {
                  return {
                    ok: false,
                    error: error instanceof Error ? error.message : "Weather lookup failed."
                  };
                }
              }
            })
          ]
        },
        requestOptions
      );

      runner.on("content", (chunk) => {
        assistantText += chunk;
        input.onChunk(chunk);
      });

      const finalContent = (await runner.finalContent()) ?? assistantText;

      if (!finalContent.trim()) {
        throw new Error("Chat completion returned an empty response.");
      }

      return assistantText || finalContent;
    }

    const stream = this.client.chat.completions.stream(
      {
        model: CHAT_MODEL,
        messages: requestMessages
      },
      requestOptions
    );

    stream.on("content", (chunk) => {
      assistantText += chunk;
      input.onChunk(chunk);
    });

    const finalContent = (await stream.finalContent()) ?? assistantText;

    if (!finalContent.trim()) {
      throw new Error("Chat completion returned an empty response.");
    }

    return assistantText || finalContent;
  }
}
