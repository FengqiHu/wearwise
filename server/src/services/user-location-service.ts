import type { OpenWeatherService } from "./openweather-service.js";

export interface BrowserLocation {
  lat: number;
  lon: number;
  timezone: string;
}

export interface UserLocationToolResult {
  ok: boolean;
  error?: string;
  location?: {
    city: string | null;
    region: string | null;
    country: string | null;
    lat: number;
    lon: number;
    timezone: string;
  };
}

export class UserLocationService {
  private readonly openWeatherService: OpenWeatherService;

  constructor(openWeatherService: OpenWeatherService) {
    this.openWeatherService = openWeatherService;
  }

  async executeTool(browserLocation: BrowserLocation | undefined, signal?: AbortSignal): Promise<UserLocationToolResult> {
    if (!browserLocation) {
      return {
        ok: false,
        error: "User location is not available. The user may not have granted location permission in their browser."
      };
    }

    const { lat, lon, timezone } = browserLocation;

    const geocoded = await this.openWeatherService.reverseGeocode(lat, lon, signal);

    return {
      ok: true,
      location: {
        city: geocoded?.name ?? null,
        region: geocoded?.state ?? null,
        country: geocoded?.country ?? null,
        lat,
        lon,
        timezone
      }
    };
  }
}
