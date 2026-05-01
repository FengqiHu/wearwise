import crypto from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type { AccessoryMode, ChatRole } from "../types/domain.js";
import { CurrentTimeService } from "./current-time-service.js";
import { OpenWeatherService, type OpenWeatherToolResult } from "./openweather-service.js";
import { UserLocationService, type BrowserLocation } from "./user-location-service.js";
import { type AiReliabilityOptions, DEFAULT_AI_RELIABILITY_OPTIONS, withTimeout } from "./ai-reliability.js";

interface ModelInputMessage {
  role: ChatRole | "system";
  content: string;
}

export interface SubmitOutfitArgs {
  outfitName: string;
  reason: string;
  occasions?: string[];
  items: Array<{ id: string; name: string }>;
  weatherSummary?: string;
}

export interface AddBackOriginalOutfit {
  outfitName: string;
  items: Array<{ id: string; name: string }>;
}

export interface AddBackAvailableAccessory {
  id: string;
  name: string;
  category: string;
  tags: string[];
}

export type AddBackResult =
  | {
      ok: true;
      originalOutfits: AddBackOriginalOutfit[];
      availableAccessories: AddBackAvailableAccessory[];
      targetOutfitIndex?: number;
    }
  | { ok: false; error: "no_recent_recommendation" | "no_accessories_in_wardrobe" };

export interface AccessoryModeContext {
  onModeChanged: (mode: AccessoryMode) => Promise<void>;
  wardrobeHasAccessories: boolean;
  onAddBackRequested: (args: { outfitIndex?: number }) => Promise<AddBackResult>;
}

export interface WardrobeItem {
  id: string;
  name: string | null;
  category: string | null;
}

interface StreamChatInput {
  messages: ModelInputMessage[];
  onChunk: (chunk: string) => void;
  onOutfit?: (outfit: SubmitOutfitArgs) => void | Promise<void>;
  signal?: AbortSignal;
  userLocation?: BrowserLocation;
  accessoryModeContext?: AccessoryModeContext;
  presetContext?: PrefetchedContext;
  wardrobeItems?: WardrobeItem[];
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

const accessoryModeToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: {
      type: "string",
      enum: ["include", "exclude", "auto"],
      description:
        "Accessory mode the user has just confirmed. " +
        "Use include when they want accessories, exclude when they don't, auto when they let you decide."
    }
  },
  required: ["mode"]
};

const accessoryModeToolInputSchema = z.object({
  mode: z.enum(["include", "exclude", "auto"])
});

type AccessoryModeToolArgs = z.infer<typeof accessoryModeToolInputSchema>;

const addAccessoriesToolParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    outfitIndex: {
      type: "integer",
      minimum: 0,
      description:
        "0-based index of a specific outfit from the most recent recommendation to extend with accessories. " +
        "Omit to add accessories to all outfits in that recommendation."
    }
  },
  required: []
};

const addAccessoriesToolInputSchema = z.object({
  outfitIndex: z.number().int().min(0).optional()
});

type AddAccessoriesToolArgs = z.infer<typeof addAccessoriesToolInputSchema>;

interface RunnerToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
  };
}

interface RunnerMessage {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: RunnerToolCall[];
}

export interface PrefetchedContext {
  weatherSummary: string | null;
  currentTime: string | null;
  locationLabel: string | null;
}

export interface StreamChatResult {
  assistantText: string;
  recommendationWeatherSummary: string | null;
}

function toIsoLocalDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
}

export function buildDeveloperInstructions(todayIsoDate: string): string {
  return [
    "You are WearWise, a personal outfit styling assistant that helps users get dressed using the clothes they already own.",
    `Today's date is ${todayIsoDate}.`,
    "Tone: warm, concise, and conversational — like a knowledgeable friend helping someone get dressed, not a product manual.",
    "Match the user's energy: casual message gets a casual reply, detailed question gets a thorough answer.",
    "Never open with filler phrases like 'Certainly!', 'Of course!', 'Great choice!', or 'Sure!'.",
    "Get straight to the point. One sentence of context is enough before acting.",
    "When the user asks for live weather, current conditions, rain, snow, temperature, or any forecast, use the get_weather tool instead of answering from memory.",
    "If the user uses a relative date such as today or tomorrow, convert it to an exact YYYY-MM-DD date before calling the tool.",
    "Use mode=current for current conditions and mode=forecast for future dates.",
    "When the user asks for a forecast, use the get_current_time and get_user_location tool to get user's local time and location if the user doesn't specify a location for the forecast. This will help you provide a more accurate forecast.",
    "If the user provides a location name without a country code and the location is ambiguous, just use the location you think is most likely based on the conversation history. Do not ask the user to clarify.",
    "If the tool returns ok=false, explain the tool error plainly. If candidates are included, ask the user to pick one of them.",
    "Never say that you do not have live internet access when the weather tool can answer the request.",
    "Never include ISO timestamps or date prefixes in your responses — timestamps in the conversation history are for your internal reasoning only, never for display.",
    "Never expose your internal reasoning or thinking steps. Output only your final response.",
  ].join(" ");
}

function buildLocationLabel(location: OpenWeatherToolResult["location"]): string | null {
  if (!location) {
    return null;
  }

  return [location.name, location.state, location.country]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(", ") || null;
}

function buildWeatherSummary(result: OpenWeatherToolResult): string | null {
  const description = result.weather?.description?.trim() || result.weather?.condition?.trim() || "";
  const temperature = typeof result.weather?.temperatureC === "number" ? `${result.weather.temperatureC} C` : "";
  const locationLabel = buildLocationLabel(result.location);
  const fragments = [locationLabel, temperature, description].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );

  if (fragments.length > 0) {
    return fragments.join(" - ");
  }

  const requestLocation = result.request?.location?.trim();
  return requestLocation && requestLocation.length > 0 ? requestLocation : null;
}

function parseWeatherToolResult(rawContent: string): string | null {
  try {
    const parsed = JSON.parse(rawContent) as OpenWeatherToolResult;

    if (!parsed.ok || !parsed.weather) {
      return null;
    }

    const summary = buildWeatherSummary(parsed);

    if (!summary) {
      return null;
    }

    return summary;
  } catch {
    return null;
  }
}

function findToolName(messages: RunnerMessage[], toolCallId: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message || !Array.isArray(message.tool_calls)) {
      continue;
    }

    const match = message.tool_calls.find(
      (toolCall) => toolCall.id === toolCallId && toolCall.type === "function" && typeof toolCall.function?.name === "string"
    );

    if (match?.function?.name) {
      return match.function.name;
    }
  }

  return null;
}

function extractRecommendationWeather(messages: RunnerMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message || message.role !== "tool" || typeof message.content !== "string" || typeof message.tool_call_id !== "string") {
      continue;
    }

    if (findToolName(messages.slice(0, index), message.tool_call_id) !== "get_weather") {
      continue;
    }

    const weather = parseWeatherToolResult(message.content);

    if (weather) {
      return weather;
    }
  }

  return null;
}

export class ChatService {
  private readonly client: OpenAI | null;
  private readonly openWeatherService: OpenWeatherService;
  private readonly currentTimeService: CurrentTimeService;
  private readonly userLocationService: UserLocationService;
  private readonly reliability: AiReliabilityOptions;

  constructor(apiKey: string, openWeatherService: OpenWeatherService, reliability: AiReliabilityOptions = {}) {
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
    this.openWeatherService = openWeatherService;
    this.currentTimeService = new CurrentTimeService();
    this.userLocationService = new UserLocationService(openWeatherService);
    this.reliability = reliability;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async prefetchWeatherAndTime(userLocation: BrowserLocation | undefined, signal?: AbortSignal): Promise<PrefetchedContext> {
    const currentTime = userLocation?.timezone
      ? (() => {
          const result = this.currentTimeService.executeTool(JSON.stringify({ timezone: userLocation.timezone }));
          return result.ok && result.datetime ? result.datetime.time : null;
        })()
      : null;

    if (!userLocation) {
      return { weatherSummary: null, currentTime, locationLabel: null };
    }

    try {
      const locationResult = await this.userLocationService.executeTool(userLocation, signal);

      if (!locationResult.ok || !locationResult.location) {
        return { weatherSummary: null, currentTime, locationLabel: null };
      }

      const loc = locationResult.location;
      const locationLabel = [loc.city, loc.region, loc.country].filter(Boolean).join(", ") || null;

      if (!loc.city) {
        return { weatherSummary: null, currentTime, locationLabel };
      }

      const weatherArgs = JSON.stringify({
        location: loc.city,
        ...(loc.region ? { stateCode: loc.region } : {}),
        ...(loc.country ? { countryCode: loc.country } : {}),
        mode: "current"
      });
      const weatherResult = await this.openWeatherService.executeTool(weatherArgs, signal);

      const weatherSummary = weatherResult.ok && weatherResult.weather
        ? buildWeatherSummary(weatherResult)
        : null;

      return { weatherSummary, currentTime, locationLabel };
    } catch {
      return { weatherSummary: null, currentTime, locationLabel: null };
    }
  }

  async streamChat(input: StreamChatInput): Promise<StreamChatResult> {
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

    const userLocation = input.userLocation;
    const accessoryModeContext = input.accessoryModeContext;

    let assistantText = "";
    const _aiTraceId = crypto.randomUUID().slice(0, 8);
    const _aiT0 = Date.now();
    const _aiPromptChars = nonEmptyMessages.reduce((n, m) => n + m.content.length, 0);
    const runner = this.client.chat.completions.runTools(
      {
        model: CHAT_MODEL,
        stream: true,
        parallel_tool_calls: false,
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
          },
          ...(accessoryModeContext
            ? [
                {
                  type: "function" as const,
                  function: {
                    name: "set_accessory_mode",
                    description:
                      "Persist the user's confirmed accessory mode preference for this conversation. " +
                      "Only call AFTER the user has explicitly confirmed their choice in the most recent turn. " +
                      "Do not call this tool to guess a preference or to 'try' a mode.",
                    parameters: accessoryModeToolParameters,
                    parse: (rawArguments: string) =>
                      accessoryModeToolInputSchema.parse(JSON.parse(rawArguments)),
                    function: async (args: AccessoryModeToolArgs) => {
                      if (args.mode === "include" && !accessoryModeContext.wardrobeHasAccessories) {
                        return { ok: false, error: "no_accessories_in_wardrobe" };
                      }
                      try {
                        await accessoryModeContext.onModeChanged(args.mode);
                        return { ok: true, newMode: args.mode };
                      } catch (error) {
                        return {
                          ok: false,
                          error:
                            error instanceof Error ? error.message : "Failed to update accessory mode."
                        };
                      }
                    }
                  }
                },
                {
                  type: "function" as const,
                  function: {
                    name: "add_accessories_to_recommendation",
                    description:
                      "Generate a new outfit recommendation that adds accessories to the user's most recent outfit(s). " +
                      "Call this AFTER the user has explicitly confirmed they want accessories added. " +
                      "Pass outfitIndex (0-based) when the user named a specific outfit (e.g. 'the second one' -> 1); " +
                      "omit outfitIndex to add accessories to all outfits in the most recent recommendation.",
                    parameters: addAccessoriesToolParameters,
                    parse: (rawArguments: string) =>
                      addAccessoriesToolInputSchema.parse(JSON.parse(rawArguments)),
                    function: async (args: AddAccessoriesToolArgs) => {
                      try {
                        return await accessoryModeContext.onAddBackRequested(
                          args.outfitIndex !== undefined ? { outfitIndex: args.outfitIndex } : {}
                        );
                      } catch (error) {
                        return {
                          ok: false as const,
                          error:
                            error instanceof Error
                              ? error.message
                              : "Failed to fetch accessories for add-back."
                        };
                      }
                    }
                  }
                }
              ]
            : []),
          {
            type: "function",
            function: {
              name: "find_wardrobe_item",
              description:
                "Look up wardrobe items by name. Use this when you are unsure of an item's exact ID before calling submit_outfit. Returns all matching items with their exact IDs.",
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                    description: "Full or partial item name to search for."
                  }
                },
                required: ["name"]
              },
              parse: (rawArguments: string) => JSON.parse(rawArguments) as { name: string },
              function: async (args: { name: string }) => {
                const query = args.name.toLowerCase();
                const matches = (input.wardrobeItems ?? []).filter(
                  (item) => item.name?.toLowerCase().includes(query)
                );
                if (matches.length === 0) {
                  return { found: false, message: "No wardrobe items matched that name." };
                }
                return {
                  found: true,
                  items: matches.map((i) => ({ id: i.id, name: i.name, category: i.category }))
                };
              }
            }
          },
          {
            type: "function",
            function: {
              name: "submit_outfit",
              description:
                "Submit a single outfit recommendation. Call this once for each outfit you want to recommend. The outfit will be displayed to the user immediately.",
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  outfitName: {
                    type: "string",
                    description: "Short descriptive name for the outfit."
                  },
                  reason: {
                    type: "string",
                    description: "Why this outfit suits the user — mention occasion and weather if known."
                  },
                  occasions: {
                    type: "array",
                    items: { type: "string" },
                    description: "Short occasion labels (e.g. 'work', 'gym'). Use empty array if none."
                  },
                  items: {
                    type: "array",
                    description: "Clothing items from the user's wardrobe.",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        id: { type: "string", description: "Exact item ID from the wardrobe." },
                        name: { type: "string", description: "Item name for display." }
                      },
                      required: ["id", "name"]
                    }
                  },
                  weatherSummary: {
                    type: "string",
                    description: "Brief factual weather summary if weather influenced this outfit (e.g. '13°C, light rain'). Omit if weather was not relevant."
                  }
                },
                required: ["outfitName", "reason", "items"]
              },
              parse: (rawArguments: string) => JSON.parse(rawArguments) as SubmitOutfitArgs,
              function: async (args: SubmitOutfitArgs) => {
                if (input.wardrobeItems) {
                  const wardrobeMap = new Map(input.wardrobeItems.map((i) => [i.id, i]));

                  const invalid = args.items.filter((item) => !wardrobeMap.has(item.id));
                  if (invalid.length > 0) {
                    return {
                      ok: false,
                      error: `Unknown item IDs: ${invalid.map((i) => `"${i.id}" ("${i.name}")`).join(", ")}. Call find_wardrobe_item to look up the correct IDs first.`
                    };
                  }

                  const seenCategories = new Map<string, string>();
                  for (const item of args.items) {
                    const category = wardrobeMap.get(item.id)?.category;
                    if (category && category !== "accessories") {
                      const existing = seenCategories.get(category);
                      if (existing) {
                        return {
                          ok: false,
                          error: `Outfit contains two items in category "${category}": "${existing}" and "${item.name}". Each outfit may have at most one item per category. Remove one of them.`
                        };
                      }
                      seenCategories.set(category, item.name);
                    }
                  }
                }
                try {
                  await input.onOutfit?.(args);
                  return { ok: true, submitted: args.outfitName };
                } catch (error) {
                  return { ok: false, error: error instanceof Error ? error.message : "Failed to submit outfit." };
                }
              }
            }
          }
        ]
      });

    runner.on("content", (content) => {
      assistantText += content;
      input.onChunk(content);
    });

    try {
      const timeoutMs = this.reliability.timeoutMs ?? DEFAULT_AI_RELIABILITY_OPTIONS.timeoutMs;
      // Do not retry active streams: chunks and submit_outfit tool events may already
      // have been emitted, so replaying the request could duplicate user-visible output.
      await withTimeout(runner.done(), timeoutMs, "OpenAI streamChat");
      console.log(JSON.stringify({ traceId: _aiTraceId, service: "chat", op: "streamChat", model: CHAT_MODEL, promptChars: _aiPromptChars, responseChars: assistantText.length, latencyMs: Date.now() - _aiT0, ok: true }));
    } catch (err) {
      console.log(JSON.stringify({ traceId: _aiTraceId, service: "chat", op: "streamChat", model: CHAT_MODEL, promptChars: _aiPromptChars, latencyMs: Date.now() - _aiT0, ok: false, error: String(err) }));
      throw err;
    }

    return {
      assistantText,
      recommendationWeatherSummary: extractRecommendationWeather(runner.messages as RunnerMessage[])
    };
  }
}
