import { describe, expect, it } from "vitest";
import { CurrentTimeService } from "./current-time-service.js";

function makeService() {
  return new CurrentTimeService();
}

describe("CurrentTimeService", () => {
  describe("executeTool – input validation", () => {
    it("returns error on invalid JSON", () => {
      const result = makeService().executeTool("not-json");

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns error on invalid timezone name", () => {
      const result = makeService().executeTool('{"timezone":"Not/A_Real_Zone"}');

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Not/A_Real_Zone");
    });
  });

  describe("executeTool – UTC default", () => {
    it("defaults to UTC when no timezone argument is provided", () => {
      const result = makeService().executeTool("{}");

      expect(result.ok).toBe(true);
      expect(result.datetime?.timezone).toBe("UTC");
    });

    it("defaults to UTC when timezone is an empty string", () => {
      const result = makeService().executeTool('{"timezone":""}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.timezone).toBe("UTC");
    });

    it("defaults to UTC when timezone is whitespace only", () => {
      const result = makeService().executeTool('{"timezone":"   "}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.timezone).toBe("UTC");
    });
  });

  describe("executeTool – valid timezone", () => {
    it("returns a result with ok=true for a valid IANA timezone", () => {
      const result = makeService().executeTool('{"timezone":"America/New_York"}');

      expect(result.ok).toBe(true);
      expect(result.datetime).toBeDefined();
    });

    it("reflects the requested timezone in the result", () => {
      const result = makeService().executeTool('{"timezone":"Asia/Tokyo"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.timezone).toBe("Asia/Tokyo");
    });

    it("returns a date string in YYYY-MM-DD format", () => {
      const result = makeService().executeTool('{"timezone":"UTC"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns a time string in HH:mm:ss format", () => {
      const result = makeService().executeTool('{"timezone":"UTC"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("returns an ISO string combining date and time", () => {
      const result = makeService().executeTool('{"timezone":"UTC"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it("returns a UTC offset in GMT+HH:MM format", () => {
      const result = makeService().executeTool('{"timezone":"UTC"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.utcOffset).toMatch(/^GMT[+-]\d{2}:\d{2}$/);
    });

    it("returns GMT+00:00 offset for UTC timezone", () => {
      const result = makeService().executeTool('{"timezone":"UTC"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.utcOffset).toBe("GMT+00:00");
    });

    it("returns a non-UTC offset for a non-UTC timezone", () => {
      // America/New_York is UTC-5 or UTC-4 depending on DST; either way not +00:00
      const result = makeService().executeTool('{"timezone":"America/New_York"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.utcOffset).not.toBe("GMT+00:00");
    });

    it("iso field is consistent with date and time fields", () => {
      const result = makeService().executeTool('{"timezone":"UTC"}');

      expect(result.ok).toBe(true);
      expect(result.datetime?.iso).toBe(`${result.datetime?.date}T${result.datetime?.time}`);
    });
  });
});
