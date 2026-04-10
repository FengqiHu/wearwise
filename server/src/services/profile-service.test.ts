import { describe, expect, it } from "vitest";
import { parseProfileFromRequest } from "./profile-service.js";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Taylor",
    heightCm: 175,
    weightKg: 68,
    styleNote: "casual streetwear",
    avatarUrl: "https://example.com/avatar.jpg",
    fullBodyImageUrl: "https://example.com/body.jpg",
    headshotImageUrl: "https://example.com/head.jpg",
    ...overrides
  };
}

describe("parseProfileFromRequest", () => {
  describe("valid inputs", () => {
    it("parses a complete valid profile with all fields", () => {
      const result = parseProfileFromRequest(validPayload());

      expect(result.error).toBeUndefined();
      expect(result.profile).toEqual({
        name: "Taylor",
        heightCm: 175,
        weightKg: 68,
        styleNote: "casual streetwear",
        avatarUrl: "https://example.com/avatar.jpg",
        fullBodyImageUrl: "https://example.com/body.jpg",
        headshotImageUrl: "https://example.com/head.jpg"
      });
    });

    it("accepts heightCm and weightKg as numeric strings", () => {
      const result = parseProfileFromRequest(validPayload({
        heightCm: "180.5",
        weightKg: "72.3"
      }));

      expect(result.error).toBeUndefined();
      expect(result.profile?.heightCm).toBe(180.5);
      expect(result.profile?.weightKg).toBe(72.3);
    });

    it("trims whitespace from name and styleNote", () => {
      const result = parseProfileFromRequest(validPayload({
        name: "  Taylor  ",
        styleNote: "  minimal  "
      }));

      expect(result.profile?.name).toBe("Taylor");
      expect(result.profile?.styleNote).toBe("minimal");
    });

    it("normalizes empty optional URLs to null", () => {
      const result = parseProfileFromRequest(validPayload({
        avatarUrl: "",
        fullBodyImageUrl: "   ",
        headshotImageUrl: ""
      }));

      expect(result.error).toBeUndefined();
      expect(result.profile?.avatarUrl).toBeNull();
      expect(result.profile?.fullBodyImageUrl).toBeNull();
      expect(result.profile?.headshotImageUrl).toBeNull();
    });

    it("sets styleNote to empty string when missing", () => {
      const payload = validPayload();
      delete (payload as Record<string, unknown>).styleNote;

      const result = parseProfileFromRequest(payload);

      expect(result.error).toBeUndefined();
      expect(result.profile?.styleNote).toBe("");
    });

    it("sets optional URLs to null when they are non-string types", () => {
      const result = parseProfileFromRequest(validPayload({
        avatarUrl: 123,
        fullBodyImageUrl: null,
        headshotImageUrl: undefined
      }));

      expect(result.error).toBeUndefined();
      expect(result.profile?.avatarUrl).toBeNull();
      expect(result.profile?.fullBodyImageUrl).toBeNull();
      expect(result.profile?.headshotImageUrl).toBeNull();
    });
  });

  describe("invalid input types", () => {
    it("returns error for null input", () => {
      const result = parseProfileFromRequest(null);
      expect(result.error).toBe("Invalid profile payload.");
      expect(result.profile).toBeUndefined();
    });

    it("returns error for undefined input", () => {
      const result = parseProfileFromRequest(undefined);
      expect(result.error).toBe("Invalid profile payload.");
    });

    it("returns error for non-object input", () => {
      const result = parseProfileFromRequest("not an object");
      expect(result.error).toBe("Invalid profile payload.");
    });
  });

  describe("name validation", () => {
    it("returns error when name is missing", () => {
      const payload = validPayload();
      delete (payload as Record<string, unknown>).name;

      const result = parseProfileFromRequest(payload);
      expect(result.error).toBe("Name is required.");
    });

    it("returns error when name is empty string", () => {
      const result = parseProfileFromRequest(validPayload({ name: "" }));
      expect(result.error).toBe("Name is required.");
    });

    it("returns error when name is only whitespace", () => {
      const result = parseProfileFromRequest(validPayload({ name: "   " }));
      expect(result.error).toBe("Name is required.");
    });
  });

  describe("heightCm validation", () => {
    it("returns error when heightCm is zero", () => {
      const result = parseProfileFromRequest(validPayload({ heightCm: 0 }));
      expect(result.error).toBe("Height must be a positive number.");
    });

    it("returns error when heightCm is negative", () => {
      const result = parseProfileFromRequest(validPayload({ heightCm: -10 }));
      expect(result.error).toBe("Height must be a positive number.");
    });

    it("returns error when heightCm is NaN", () => {
      const result = parseProfileFromRequest(validPayload({ heightCm: NaN }));
      expect(result.error).toBe("Height must be a positive number.");
    });

    it("returns error when heightCm is a non-numeric string", () => {
      const result = parseProfileFromRequest(validPayload({ heightCm: "tall" }));
      expect(result.error).toBe("Height must be a positive number.");
    });

    it("returns error when heightCm is a boolean", () => {
      const result = parseProfileFromRequest(validPayload({ heightCm: true }));
      expect(result.error).toBe("Height must be a positive number.");
    });
  });

  describe("weightKg validation", () => {
    it("returns error when weightKg is zero", () => {
      const result = parseProfileFromRequest(validPayload({ weightKg: 0 }));
      expect(result.error).toBe("Weight must be a positive number.");
    });

    it("returns error when weightKg is negative", () => {
      const result = parseProfileFromRequest(validPayload({ weightKg: -5 }));
      expect(result.error).toBe("Weight must be a positive number.");
    });

    it("returns error when weightKg is NaN", () => {
      const result = parseProfileFromRequest(validPayload({ weightKg: NaN }));
      expect(result.error).toBe("Weight must be a positive number.");
    });

    it("returns error when weightKg is a non-numeric string", () => {
      const result = parseProfileFromRequest(validPayload({ weightKg: "heavy" }));
      expect(result.error).toBe("Weight must be a positive number.");
    });
  });
});
