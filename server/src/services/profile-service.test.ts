import { describe, expect, it } from "vitest";
import { parseProfileFromRequest } from "./profile-service.js";

const BASE_PAYLOAD = {
  name: "Taylor",
  heightCm: 175,
  weightKg: 68,
  styleNote: "casual"
};

describe("parseProfileFromRequest – sex field", () => {
  it("accepts 'male' as a valid sex value", () => {
    const result = parseProfileFromRequest({ ...BASE_PAYLOAD, sex: "male" });

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBe("male");
  });

  it("accepts 'female' as a valid sex value", () => {
    const result = parseProfileFromRequest({ ...BASE_PAYLOAD, sex: "female" });

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBe("female");
  });

  it("accepts 'other' as a valid sex value", () => {
    const result = parseProfileFromRequest({ ...BASE_PAYLOAD, sex: "other" });

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBe("other");
  });

  it("omits sex from profile when sex is not provided", () => {
    const result = parseProfileFromRequest(BASE_PAYLOAD);

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBeUndefined();
  });

  it("ignores an invalid sex value and omits sex from profile", () => {
    const result = parseProfileFromRequest({ ...BASE_PAYLOAD, sex: "unknown" });

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBeUndefined();
  });

  it("ignores a numeric sex value and omits sex from profile", () => {
    const result = parseProfileFromRequest({ ...BASE_PAYLOAD, sex: 1 });

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBeUndefined();
  });

  it("ignores null sex value and omits sex from profile", () => {
    const result = parseProfileFromRequest({ ...BASE_PAYLOAD, sex: null });

    expect(result.error).toBeUndefined();
    expect(result.profile?.sex).toBeUndefined();
  });

  it("still validates other required fields when sex is valid", () => {
    const result = parseProfileFromRequest({ name: "", heightCm: 175, weightKg: 68, sex: "male" });

    expect(result.error).toBe("Name is required.");
    expect(result.profile).toBeUndefined();
  });
});
