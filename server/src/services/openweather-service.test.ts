import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenWeatherService } from "./openweather-service.js";

const { mockFetch } = vi.hoisted(() => {
  const mockFetch = vi.fn();
  return { mockFetch };
});

vi.mock("../lib/http.js", () => ({
  fetchWithTimeout: mockFetch
}));

function makeResponse(ok: boolean, data: unknown, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data)
  } as unknown as Response;
}

const BALTIMORE: GeocodeLocation = {
  name: "Baltimore",
  lat: 39.29,
  lon: -76.61,
  country: "US",
  state: "Maryland"
};

const PARIS_FR: GeocodeLocation = {
  name: "Paris",
  lat: 48.86,
  lon: 2.35,
  country: "FR"
};

const PARIS_TX: GeocodeLocation = {
  name: "Paris",
  lat: 33.66,
  lon: -95.56,
  country: "US",
  state: "Texas"
};

interface GeocodeLocation {
  name: string;
  lat: number;
  lon: number;
  country: string;
  state?: string;
}

const CURRENT_WEATHER_PAYLOAD = {
  dt: 1700000000,
  timezone: -18000,
  weather: [{ main: "Rain", description: "light rain" }],
  main: {
    temp: 15.6,
    feels_like: 14.2,
    temp_min: 13.0,
    temp_max: 17.3,
    humidity: 80
  },
  wind: { speed: 3.5 },
  rain: { "1h": 0.5 }
};

const FORECAST_PAYLOAD = {
  city: { timezone: -18000 },
  list: [
    {
      dt: 1700049600, // 2023-11-15 00:00 UTC-5 => 2023-11-14 19:00 UTC
      weather: [{ main: "Clouds", description: "overcast clouds" }],
      main: { temp: 12.0, feels_like: 11.0, temp_min: 11.0, temp_max: 13.0, humidity: 70 },
      wind: { speed: 2.0 },
      pop: 0.2
    },
    {
      dt: 1700060400, // 2023-11-15 03:00 UTC-5
      weather: [{ main: "Clear", description: "clear sky" }],
      main: { temp: 14.0, feels_like: 13.0, temp_min: 13.0, temp_max: 15.0, humidity: 60 },
      wind: { speed: 1.5 },
      pop: 0.1
    }
  ]
};

function makeService(apiKey = "test-api-key") {
  return new OpenWeatherService(apiKey);
}

describe("OpenWeatherService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isConfigured", () => {
    it("returns true when API key is set", () => {
      expect(makeService("some-key").isConfigured()).toBe(true);
    });

    it("returns false when API key is empty", () => {
      expect(makeService("").isConfigured()).toBe(false);
    });
  });

  describe("executeTool – input validation", () => {
    it("returns error when not configured", async () => {
      const result = await makeService("").executeTool('{"location":"Baltimore"}');
      expect(result.ok).toBe(false);
      expect(result.error).toContain("OPENWEATHER_API_KEY");
    });

    it("returns error on invalid JSON", async () => {
      const result = await makeService().executeTool("not-json");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("valid JSON");
    });

    it("returns error when location is missing", async () => {
      const result = await makeService().executeTool('{"mode":"current"}');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error when location is empty string", async () => {
      const result = await makeService().executeTool('{"location":""}');
      expect(result.ok).toBe(false);
      expect(result.error).toContain("location");
    });

    it("returns error when forecast mode has no targetDate", async () => {
      const result = await makeService().executeTool('{"location":"Baltimore","mode":"forecast"}');
      expect(result.ok).toBe(false);
      expect(result.error).toContain("targetDate");
    });

    it("returns error when countryCode is not 2 characters", async () => {
      const result = await makeService().executeTool('{"location":"Baltimore","countryCode":"USA"}');
      expect(result.ok).toBe(false);
    });
  });

  describe("executeTool – current weather success", () => {
    it("returns structured weather result for a single geocode match", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, CURRENT_WEATHER_PAYLOAD));

      const result = await makeService().executeTool('{"location":"Baltimore","countryCode":"US"}');

      expect(result.ok).toBe(true);
      expect(result.location?.name).toBe("Baltimore");
      expect(result.location?.country).toBe("US");
      expect(result.location?.state).toBe("Maryland");
      expect(result.weather?.mode).toBe("current");
      expect(result.weather?.condition).toBe("Rain");
      expect(result.weather?.description).toBe("light rain");
      expect(result.weather?.temperatureC).toBe(15.6);
      expect(result.weather?.feelsLikeC).toBe(14.2);
      expect(result.weather?.humidityPct).toBe(80);
      expect(result.weather?.windSpeedMps).toBe(3.5);
      expect(result.weather?.rainVolumeMm).toBe(0.5);
      expect(result.weather?.snowVolumeMm).toBeNull();
      expect(result.weather?.precipitationProbabilityPct).toBeNull();
      expect(result.request?.units).toBe("metric");
    });

    it("includes stateCode and countryCode in request when provided", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, CURRENT_WEATHER_PAYLOAD));

      const result = await makeService().executeTool(
        '{"location":"Baltimore","stateCode":"Maryland","countryCode":"US"}'
      );

      expect(result.ok).toBe(true);
      expect(result.request?.stateCode).toBe("Maryland");
      expect(result.request?.countryCode).toBe("US");
    });

    it("returns null windSpeedMps when wind is absent", async () => {
      const payloadNoWind = { ...CURRENT_WEATHER_PAYLOAD, wind: undefined };

      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, payloadNoWind));

      const result = await makeService().executeTool('{"location":"Baltimore","countryCode":"US"}');

      expect(result.ok).toBe(true);
      expect(result.weather?.windSpeedMps).toBeNull();
    });

    it("returns snow volume when snow data is present", async () => {
      const payloadWithSnow = {
        ...CURRENT_WEATHER_PAYLOAD,
        rain: undefined,
        snow: { "1h": 1.2 },
        weather: [{ main: "Snow", description: "light snow" }]
      };

      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, payloadWithSnow));

      const result = await makeService().executeTool('{"location":"Baltimore","countryCode":"US"}');

      expect(result.ok).toBe(true);
      expect(result.weather?.snowVolumeMm).toBe(1.2);
      expect(result.weather?.rainVolumeMm).toBeNull();
    });
  });

  describe("executeTool – ambiguous location", () => {
    it("returns candidates when multiple distinct locations match", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(true, [PARIS_FR, PARIS_TX]));

      const result = await makeService().executeTool('{"location":"Paris"}');

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ambiguous");
      expect(result.candidates).toContain("Paris, FR");
      expect(result.candidates).toContain("Paris, Texas, US");
    });

    it("proceeds with first match when countryCode is provided despite multiple results", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [PARIS_FR]))
        .mockResolvedValueOnce(makeResponse(true, CURRENT_WEATHER_PAYLOAD));

      const result = await makeService().executeTool('{"location":"Paris","countryCode":"FR"}');

      expect(result.ok).toBe(true);
      expect(result.location?.country).toBe("FR");
    });
  });

  describe("executeTool – geocode HTTP errors", () => {
    it("returns error when geocode request fails", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(false, null, 500));

      const result = await makeService().executeTool('{"location":"Baltimore"}');

      expect(result.ok).toBe(false);
      expect(result.error).toContain("500");
    });

    it("returns error when no geocode results are found", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(true, []));

      const result = await makeService().executeTool('{"location":"Atlantis"}');

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Atlantis");
    });
  });

  describe("executeTool – weather HTTP errors", () => {
    it("returns error when current weather request fails", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(false, null, 503));

      const result = await makeService().executeTool('{"location":"Baltimore","countryCode":"US"}');

      expect(result.ok).toBe(false);
      expect(result.error).toContain("503");
    });

    it("returns error when forecast request fails", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(false, null, 429));

      const result = await makeService().executeTool(
        '{"location":"Baltimore","countryCode":"US","mode":"forecast","targetDate":"2023-11-15"}'
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("429");
    });
  });

  describe("executeTool – forecast success", () => {
    it("returns forecast entry closest to requested time", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, FORECAST_PAYLOAD));

      const result = await makeService().executeTool(
        '{"location":"Baltimore","countryCode":"US","mode":"forecast","targetDate":"2023-11-15","targetTime":"12:00"}'
      );

      expect(result.ok).toBe(true);
      expect(result.weather?.mode).toBe("forecast");
      expect(result.request?.targetDate).toBe("2023-11-15");
      expect(result.request?.targetTime).toBe("12:00");
    });

    it("returns error when no forecast entries exist for target date", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, { city: { timezone: 0 }, list: [] }));

      const result = await makeService().executeTool(
        '{"location":"Baltimore","countryCode":"US","mode":"forecast","targetDate":"2099-01-01"}'
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("2099-01-01");
    });

    it("includes precipitationProbabilityPct in forecast result", async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse(true, [BALTIMORE]))
        .mockResolvedValueOnce(makeResponse(true, FORECAST_PAYLOAD));

      const result = await makeService().executeTool(
        '{"location":"Baltimore","countryCode":"US","mode":"forecast","targetDate":"2023-11-15"}'
      );

      expect(result.ok).toBe(true);
      expect(result.weather?.precipitationProbabilityPct).not.toBeNull();
    });
  });

  describe("reverseGeocode", () => {
    it("returns city, state and country for a known coordinate", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(true, [BALTIMORE]));

      const result = await makeService().reverseGeocode(39.29, -76.61);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Baltimore");
      expect(result?.state).toBe("Maryland");
      expect(result?.country).toBe("US");
    });

    it("returns result without state when state is absent", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(true, [PARIS_FR]));

      const result = await makeService().reverseGeocode(48.86, 2.35);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("Paris");
      expect(result?.country).toBe("FR");
      expect(result?.state).toBeUndefined();
    });

    it("returns null when API returns a non-ok response", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(false, null, 401));

      const result = await makeService().reverseGeocode(0, 0);

      expect(result).toBeNull();
    });

    it("returns null when API returns an empty array", async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(true, []));

      const result = await makeService().reverseGeocode(0, 0);

      expect(result).toBeNull();
    });

    it("returns null when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await makeService().reverseGeocode(0, 0);

      expect(result).toBeNull();
    });
  });
});
