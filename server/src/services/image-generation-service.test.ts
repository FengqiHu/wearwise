import { describe, expect, it } from "vitest";
import { buildMainPrompt } from "./image-generation-service.js";

describe("buildMainPrompt", () => {
  it("uses photorealistic language instead of fashion-forward", () => {
    const prompt = buildMainPrompt({});

    expect(prompt).toContain("photorealistic");
    expect(prompt).not.toContain("fashion-forward");
  });

  it("includes occasion context when occasions are provided", () => {
    const prompt = buildMainPrompt({ occasions: ["gym", "workout"] });

    expect(prompt).toContain("gym");
    expect(prompt).toContain("workout");
    expect(prompt).toContain("intended for");
  });

  it("includes weather context when weatherSummary is provided", () => {
    const prompt = buildMainPrompt({ weatherSummary: "13°C, light rain" });

    expect(prompt).toContain("13°C, light rain");
    expect(prompt).toContain("Weather conditions");
  });

  it("includes both occasion and weather when both are provided", () => {
    const prompt = buildMainPrompt({
      occasions: ["work meeting"],
      weatherSummary: "20°C, sunny"
    });

    expect(prompt).toContain("work meeting");
    expect(prompt).toContain("20°C, sunny");
  });

  it("uses neutral background when no backgroundContext is provided", () => {
    const prompt = buildMainPrompt({});

    expect(prompt).toContain("neutral");
  });

  it("includes backgroundContext in background instruction when provided", () => {
    const prompt = buildMainPrompt({ backgroundContext: "Casual gym look" });

    expect(prompt).toContain("Casual gym look");
    expect(prompt).toContain("gym interior");
  });

  it("omits context instruction when no occasion or weather is provided", () => {
    const prompt = buildMainPrompt({});

    expect(prompt).not.toContain("Context for this outfit");
  });
});
