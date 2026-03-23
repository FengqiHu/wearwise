import { z } from "zod";
import { fetchWithTimeout } from "../lib/http.js";

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

type WeatherToolInput = z.infer<typeof weatherToolInputSchema>;

interface GeocodeLocation {
  name: string;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

interface WeatherCondition {
  main: string;
  description: string;
}

interface CurrentWeatherResponse {
  dt: number;
  timezone: number;
  weather: WeatherCondition[];
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    humidity: number;
  };
  wind?: {
    speed?: number;
  };
  rain?: {
    "1h"?: number;
    "3h"?: number;
  };
  snow?: {
    "1h"?: number;
    "3h"?: number;
  };
}

interface ForecastEntry {
  dt: number;
  pop?: number;
  weather: WeatherCondition[];
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    humidity: number;
  };
  wind?: {
    speed?: number;
  };
  rain?: {
    "3h"?: number;
  };
  snow?: {
    "3h"?: number;
  };
}

interface ForecastResponse {
  list: ForecastEntry[];
  city: {
    timezone: number;
  };
}

export interface OpenWeatherToolResult {
  ok: boolean;
  error?: string;
  candidates?: string[];
  request?: {
    location: string;
    mode: "current" | "forecast";
    stateCode?: string;
    countryCode?: string;
    targetDate?: string;
    targetTime?: string;
    units: "metric";
  };
  location?: {
    name: string;
    state: string | null;
    country: string;
    lat: number;
    lon: number;
  };
  weather?: {
    mode: "current" | "forecast";
    timestampLocal: string;
    description: string;
    condition: string;
    temperatureC: number;
    feelsLikeC: number;
    tempMinC: number;
    tempMaxC: number;
    humidityPct: number;
    windSpeedMps: number | null;
    precipitationProbabilityPct: number | null;
    rainVolumeMm: number | null;
    snowVolumeMm: number | null;
  };
}

// keep the last one digit number
function toRoundedNumber(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(1));
}

// pad the number to 2 digits, for example: 1 -> 01, 10 -> 10
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function getLocalDateTimeParts(unixSeconds: number, timezoneOffsetSeconds: number): {
  year: number;
  month: string;
  day: string;
  hours: string;
  minutes: string;
} {
  const date = new Date((unixSeconds + timezoneOffsetSeconds) * 1000);

  return {
    year: date.getUTCFullYear(),
    month: pad(date.getUTCMonth() + 1),
    day: pad(date.getUTCDate()),
    hours: pad(date.getUTCHours()),
    minutes: pad(date.getUTCMinutes())
  };
}

// format date to YYYY-MM-DD, for example: 2024-06-10
function formatLocalDate(unixSeconds: number, timezoneOffsetSeconds: number): string {
  const { year, month, day } = getLocalDateTimeParts(unixSeconds, timezoneOffsetSeconds);
  return `${year}-${month}-${day}`;
}

// format time to HH:mm => 15:00
function formatLocalTime(unixSeconds: number, timezoneOffsetSeconds: number): string {
  const { hours, minutes } = getLocalDateTimeParts(unixSeconds, timezoneOffsetSeconds);
  return `${hours}:${minutes}`;
}

// format timestamp to local date and time => 2024-06-10 15:00
function formatLocalTimestamp(unixSeconds: number, timezoneOffsetSeconds: number): string {
  const { year, month, day, hours, minutes } = getLocalDateTimeParts(unixSeconds, timezoneOffsetSeconds);
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// get the precipitation volume, OpenWeather may return in 1h or 3h
function getPrecipitationVolume(
  payload?: {
    "1h"?: number;
    "3h"?: number;
  } | null
): number | null {
  if (!payload) {
    return null;
  }

  return toRoundedNumber(payload["1h"] ?? payload["3h"]);
}

// format the location as: Baltimore, Maryland, US
function buildLocationLabel(location: GeocodeLocation): string {
  return [location.name, location.state, location.country].filter(Boolean).join(", ");
}

// normalize the state code and country code to upper case, for example: us -> US, ma -> MA
function normalizeCode(value: string | undefined): string | undefined {
  return value?.trim().toUpperCase() || undefined;
}

// deal the error msgs from zod validation
function formatZodError(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" ");
}

function createFetchOptions(signal?: AbortSignal): {
  method: "GET";
  timeoutMs: number;
  signal?: AbortSignal | null;
} {
  return signal
    ? {
        method: "GET",
        signal,
        timeoutMs: 10000
      }
    : {
        method: "GET",
        timeoutMs: 10000
      };
}

export class OpenWeatherService {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async executeTool(rawArguments: string, signal?: AbortSignal): Promise<OpenWeatherToolResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        error: "OPENWEATHER_API_KEY is not configured on the server."
      };
    }

    let parsedInput: unknown;

    try {
      // the sending info should be a JSON string, parse it before validation
      parsedInput = JSON.parse(rawArguments);
    } catch {
      return {
        ok: false,
        error: "Invalid get_weather tool arguments. The payload must be valid JSON."
      };
    }

    const parsed = weatherToolInputSchema.safeParse({
      ...((parsedInput as Record<string, unknown>) ?? {}),
      countryCode: normalizeCode((parsedInput as { countryCode?: string } | null)?.countryCode),
      stateCode: (parsedInput as { stateCode?: string } | null)?.stateCode?.trim()
    });

    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error)
      };
    }

    return this.lookupWeather(parsed.data, signal);
  }

  private async lookupWeather(input: WeatherToolInput, signal?: AbortSignal): Promise<OpenWeatherToolResult> {
    const locationResolution = await this.resolveLocation(input, signal);

    if (!locationResolution.ok) {
      return locationResolution;
    }

    // determine the weather mode
    return input.mode === "forecast"
      ? this.getForecastWeather(input, locationResolution.location, signal)
      : this.getCurrentWeather(input, locationResolution.location, signal);
  }

  private async resolveLocation(
    input: WeatherToolInput,
    signal?: AbortSignal
  ): Promise<
    | {
        ok: true;
        location: GeocodeLocation;
      }
    | {
        ok: false;
        error: string;
        candidates?: string[];
      }
  > {
    const query = [input.location, input.stateCode, input.countryCode].filter(Boolean).join(",");
    const endpoint = new URL("https://api.openweathermap.org/geo/1.0/direct");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("limit", "5");
    endpoint.searchParams.set("appid", this.apiKey);

    const response = await fetchWithTimeout(endpoint.toString(), createFetchOptions(signal));

    if (!response.ok) {
      return {
        ok: false,
        error: `OpenWeather geocoding request failed with status ${response.status}.`
      };
    }

    const matches = (await response.json()) as GeocodeLocation[];

    if (matches.length === 0) {
      return {
        ok: false,
        error: `No matching weather location was found for "${input.location}".`
      };
    }

    const distinctCandidates = Array.from(new Set(matches.map(buildLocationLabel).filter(Boolean)));
    const shouldAskForClarification = !input.stateCode && !input.countryCode && distinctCandidates.length > 1;

    if (shouldAskForClarification) {
      return {
        ok: false,
        error: `The location "${input.location}" is ambiguous. Ask the user for a state or country.`,
        candidates: distinctCandidates.slice(0, 5)
      };
    }

    const firstMatch = matches[0];

    if (!firstMatch) {
      return {
        ok: false,
        error: `No matching weather location was found for "${input.location}".`
      };
    }

    return {
      ok: true,
      location: firstMatch
    };
  }

  private async getCurrentWeather(
    input: WeatherToolInput,
    location: GeocodeLocation,
    signal?: AbortSignal
  ): Promise<OpenWeatherToolResult> {
    const endpoint = new URL("https://api.openweathermap.org/data/2.5/weather");
    endpoint.searchParams.set("lat", String(location.lat));
    endpoint.searchParams.set("lon", String(location.lon));
    endpoint.searchParams.set("units", "metric");
    endpoint.searchParams.set("appid", this.apiKey);

    const response = await fetchWithTimeout(endpoint.toString(), createFetchOptions(signal));

    if (!response.ok) {
      return {
        ok: false,
        error: `OpenWeather current weather request failed with status ${response.status}.`
      };
    }

    const payload = (await response.json()) as CurrentWeatherResponse;
    const primaryWeather = payload.weather[0];

    if (!primaryWeather) {
      return {
        ok: false,
        error: "OpenWeather returned an unexpected current weather payload."
      };
    }

    return {
      ok: true,
      request: {
        location: input.location,
        mode: "current",
        ...(input.stateCode ? { stateCode: input.stateCode } : {}),
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        units: "metric"
      },
      location: {
        name: location.name,
        state: location.state ?? null,
        country: location.country,
        lat: location.lat,
        lon: location.lon
      },
      weather: {
        mode: "current",
        timestampLocal: formatLocalTimestamp(payload.dt, payload.timezone),
        description: primaryWeather.description,
        condition: primaryWeather.main,
        temperatureC: Number(payload.main.temp.toFixed(1)),
        feelsLikeC: Number(payload.main.feels_like.toFixed(1)),
        tempMinC: Number(payload.main.temp_min.toFixed(1)),
        tempMaxC: Number(payload.main.temp_max.toFixed(1)),
        humidityPct: payload.main.humidity,
        windSpeedMps: toRoundedNumber(payload.wind?.speed),
        precipitationProbabilityPct: null,
        rainVolumeMm: getPrecipitationVolume(payload.rain),
        snowVolumeMm: getPrecipitationVolume(payload.snow)
      }
    };
  }

  private async getForecastWeather(
    input: WeatherToolInput,
    location: GeocodeLocation,
    signal?: AbortSignal
  ): Promise<OpenWeatherToolResult> {
    const endpoint = new URL("https://api.openweathermap.org/data/2.5/forecast");
    endpoint.searchParams.set("lat", String(location.lat));
    endpoint.searchParams.set("lon", String(location.lon));
    endpoint.searchParams.set("units", "metric");
    endpoint.searchParams.set("appid", this.apiKey);

    const response = await fetchWithTimeout(endpoint.toString(), createFetchOptions(signal));

    if (!response.ok) {
      return {
        ok: false,
        error: `OpenWeather forecast request failed with status ${response.status}.`
      };
    }

    const payload = (await response.json()) as ForecastResponse;
    const targetDate = input.targetDate;

    if (!targetDate) {
      return {
        ok: false,
        error: "targetDate is required when mode is forecast."
      };
    }

    const preferredTime = input.targetTime ?? "12:00";
    const forecastEntries = payload.list.filter(
      (entry) => formatLocalDate(entry.dt, payload.city.timezone) === targetDate
    );

    if (forecastEntries.length === 0) {
      return {
        ok: false,
        error: `No forecast data is available for ${targetDate}. OpenWeather forecast data usually covers about the next 5 days.`
      };
    }

    const targetMinutes = this.toMinutes(preferredTime);
    const firstEntry = forecastEntries[0];

    if (!firstEntry) {
      return {
        ok: false,
        error: `No forecast data is available for ${targetDate}.`
      };
    }

    let bestEntry: ForecastEntry = firstEntry;
    let bestDifference = Number.POSITIVE_INFINITY;

    for (const entry of forecastEntries) {
      const entryDifference = Math.abs(this.toMinutes(formatLocalTime(entry.dt, payload.city.timezone)) - targetMinutes);

      if (entryDifference < bestDifference) {
        bestEntry = entry;
        bestDifference = entryDifference;
      }
    }

    const primaryWeather = bestEntry.weather[0];

    if (!primaryWeather) {
      return {
        ok: false,
        error: "OpenWeather returned an unexpected forecast payload."
      };
    }

    return {
      ok: true,
      request: {
        location: input.location,
        mode: "forecast",
        ...(input.stateCode ? { stateCode: input.stateCode } : {}),
        ...(input.countryCode ? { countryCode: input.countryCode } : {}),
        targetDate,
        ...(input.targetTime ? { targetTime: input.targetTime } : {}),
        units: "metric"
      },
      location: {
        name: location.name,
        state: location.state ?? null,
        country: location.country,
        lat: location.lat,
        lon: location.lon
      },
      weather: {
        mode: "forecast",
        timestampLocal: formatLocalTimestamp(bestEntry.dt, payload.city.timezone),
        description: primaryWeather.description,
        condition: primaryWeather.main,
        temperatureC: Number(bestEntry.main.temp.toFixed(1)),
        feelsLikeC: Number(bestEntry.main.feels_like.toFixed(1)),
        tempMinC: Number(bestEntry.main.temp_min.toFixed(1)),
        tempMaxC: Number(bestEntry.main.temp_max.toFixed(1)),
        humidityPct: bestEntry.main.humidity,
        windSpeedMps: toRoundedNumber(bestEntry.wind?.speed),
        precipitationProbabilityPct: toRoundedNumber((bestEntry.pop ?? 0) * 100),
        rainVolumeMm: getPrecipitationVolume(bestEntry.rain),
        snowVolumeMm: getPrecipitationVolume(bestEntry.snow)
      }
    };
  }

  private toMinutes(time: string): number {
    const [hoursPart = "0", minutesPart = "0"] = time.split(":");
    const hours = Number.parseInt(hoursPart, 10);
    const minutes = Number.parseInt(minutesPart, 10);
    return hours * 60 + minutes;
  }
}
