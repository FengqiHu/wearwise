import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "./chat-service.js";
import { OpenWeatherService } from "./openweather-service.js";

let capturedDeveloperContent = "";

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        runTools: vi.fn((params: { messages: Array<{ role: string; content: string }> }) => {
          const devMsg = params.messages.find((m) => m.role === "developer");
          capturedDeveloperContent = devMsg?.content ?? "";
          return {
            on: vi.fn(),
            done: vi.fn().mockResolvedValue(undefined),
            messages: []
          };
        })
      }
    };
  }
}));

vi.mock("./openweather-service.js", () => ({
  OpenWeatherService: class {
    executeTool = vi.fn().mockResolvedValue({ ok: false, error: "mocked" });
  }
}));

describe("buildDeveloperInstructions (#327)", () => {
  beforeEach(async () => {
    capturedDeveloperContent = "";
    const service = new ChatService("test-api-key", new OpenWeatherService(""));
    await service.streamChat({
      messages: [{ role: "user", content: "Hello" }],
      onChunk: vi.fn()
    });
  });

  it("instructs the LLM never to include ISO timestamps in responses", () => {
    expect(capturedDeveloperContent).toContain(
      "Never include ISO timestamps or date prefixes in your responses"
    );
  });

  it("instructs the LLM never to expose internal reasoning", () => {
    expect(capturedDeveloperContent).toContain(
      "Never expose your internal reasoning or thinking steps"
    );
  });
});
