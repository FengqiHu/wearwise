import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenWeatherService } from "./openweather-service.js";
import { UserLocationService } from "./user-location-service.js";

function makeMockOpenWeatherService(
  reverseGeocodeResult: Awaited<ReturnType<OpenWeatherService["reverseGeocode"]>> = null
): OpenWeatherService {
  return {
    reverseGeocode: vi.fn().mockResolvedValue(reverseGeocodeResult)
  } as unknown as OpenWeatherService;
}

const BROWSER_LOCATION = {
  lat: 39.29,
  lon: -76.61,
  timezone: "America/New_York"
};

describe("UserLocationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("executeTool – no location provided", () => {
    it("returns an error when browserLocation is undefined", async () => {
      const service = new UserLocationService(makeMockOpenWeatherService());
      const result = await service.executeTool(undefined);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.location).toBeUndefined();
    });

    it("error message mentions location permission", async () => {
      const service = new UserLocationService(makeMockOpenWeatherService());
      const result = await service.executeTool(undefined);

      expect(result.error?.toLowerCase()).toMatch(/location|permission/);
    });
  });

  describe("executeTool – with browser location", () => {
    it("returns city, region, country and coordinates when reverse geocode succeeds", async () => {
      const mockOpenWeather = makeMockOpenWeatherService({
        name: "Baltimore",
        state: "Maryland",
        country: "US"
      });
      const service = new UserLocationService(mockOpenWeather);
      const result = await service.executeTool(BROWSER_LOCATION);

      expect(result.ok).toBe(true);
      expect(result.location?.city).toBe("Baltimore");
      expect(result.location?.region).toBe("Maryland");
      expect(result.location?.country).toBe("US");
      expect(result.location?.lat).toBe(39.29);
      expect(result.location?.lon).toBe(-76.61);
      expect(result.location?.timezone).toBe("America/New_York");
    });

    it("passes the browser coordinates to reverseGeocode", async () => {
      const mockOpenWeather = makeMockOpenWeatherService({ name: "Baltimore", country: "US" });
      const service = new UserLocationService(mockOpenWeather);

      await service.executeTool(BROWSER_LOCATION);

      expect(mockOpenWeather.reverseGeocode).toHaveBeenCalledWith(39.29, -76.61, undefined);
    });

    it("forwards the AbortSignal to reverseGeocode", async () => {
      const mockOpenWeather = makeMockOpenWeatherService({ name: "Baltimore", country: "US" });
      const service = new UserLocationService(mockOpenWeather);
      const signal = new AbortController().signal;

      await service.executeTool(BROWSER_LOCATION, signal);

      expect(mockOpenWeather.reverseGeocode).toHaveBeenCalledWith(39.29, -76.61, signal);
    });

    it("returns null city and region when reverse geocode returns null", async () => {
      const mockOpenWeather = makeMockOpenWeatherService(null);
      const service = new UserLocationService(mockOpenWeather);
      const result = await service.executeTool(BROWSER_LOCATION);

      expect(result.ok).toBe(true);
      expect(result.location?.city).toBeNull();
      expect(result.location?.region).toBeNull();
      expect(result.location?.country).toBeNull();
    });

    it("still returns coordinates and timezone when reverse geocode returns null", async () => {
      const mockOpenWeather = makeMockOpenWeatherService(null);
      const service = new UserLocationService(mockOpenWeather);
      const result = await service.executeTool(BROWSER_LOCATION);

      expect(result.ok).toBe(true);
      expect(result.location?.lat).toBe(39.29);
      expect(result.location?.lon).toBe(-76.61);
      expect(result.location?.timezone).toBe("America/New_York");
    });

    it("returns null region when reverse geocode result has no state", async () => {
      const mockOpenWeather = makeMockOpenWeatherService({ name: "Paris", country: "FR" });
      const service = new UserLocationService(mockOpenWeather);
      const result = await service.executeTool({ lat: 48.86, lon: 2.35, timezone: "Europe/Paris" });

      expect(result.ok).toBe(true);
      expect(result.location?.city).toBe("Paris");
      expect(result.location?.region).toBeNull();
      expect(result.location?.country).toBe("FR");
    });
  });
});
