import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIContentClient } from "./openai-content-client.js";
import { ImageModerationService, ImageModerationRejectedError, ImageModerationUnavailableError } from "./image-moderation-service.js";

const { createResponse, moderate } = vi.hoisted(() => ({ createResponse: vi.fn(), moderate: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  responses = { create: createResponse };
  moderations = { create: moderate };
} }));

describe("OpenAI image processing", () => {
  beforeEach(() => {
    createResponse.mockReset();
    moderate.mockReset();
  });

  it("sends image bytes and a strict output schema to Responses without storing the response", async () => {
    createResponse.mockResolvedValue({ status: "completed", output_text: '{"hasRealHuman":true}' });
    const client = new OpenAIContentClient({ apiKey: "test" });
    const schema = { type: "object", properties: { hasRealHuman: { type: "boolean" } }, required: ["hasRealHuman"], additionalProperties: false };
    const response = await client.models.generateContent({
      model: "gpt-5-mini",
      contents: [{ parts: [{ inlineData: { data: "aW1hZ2U=", mimeType: "image/jpeg" } }, { text: "Identify the image." }] }],
      config: { responseJsonSchema: schema }
    });
    expect(response.text).toBe('{"hasRealHuman":true}');
    expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({
      store: false,
      input: [{ role: "user", content: [
        { type: "input_image", image_url: "data:image/jpeg;base64,aW1hZ2U=", detail: "auto" },
        { type: "input_text", text: "Identify the image." }
      ] }],
      text: { format: { type: "json_schema", name: "wearwise_result", schema, strict: true } }
    }));
  });

  it("rejects incomplete or refused recognition output", async () => {
    createResponse.mockResolvedValue({ status: "incomplete", output_text: "" });
    await expect(new OpenAIContentClient({ apiKey: "test" }).models.generateContent({
      model: "gpt-5-mini", contents: [{ parts: [{ text: "Identify" }] }]
    })).rejects.toThrow("complete analysis result");
  });

  it("uses OpenAI image moderation and preserves the actual image MIME type", async () => {
    moderate.mockResolvedValue({ results: [{ flagged: false, categories: {} }] });
    const service = new ImageModerationService({ apiKey: "", openaiApiKey: "test" });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(service.isConfigured()).toBe(true);
    await expect(service.reviewImage(png)).resolves.toEqual({});
    expect(moderate).toHaveBeenCalledWith({ model: "omni-moderation-latest", input: [
      { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }
    ] });
  });

  it("rejects flagged content", async () => {
    moderate.mockResolvedValue({ results: [{ flagged: true, categories: { sexual: true } }] });
    const service = new ImageModerationService({ apiKey: "", openaiApiKey: "test" });
    await expect(service.reviewImage(Buffer.from("image"))).rejects.toThrow(ImageModerationRejectedError);
  });

  it.each([undefined, { flagged: undefined }])("blocks uploads when no moderation verdict is returned", async (result) => {
    moderate.mockResolvedValue({ results: result ? [result] : [] });
    const service = new ImageModerationService({ apiKey: "", openaiApiKey: "test" });
    await expect(service.reviewImage(Buffer.from("image"))).rejects.toThrow(ImageModerationUnavailableError);
  });

  it("blocks uploads when the moderation provider fails", async () => {
    moderate.mockRejectedValue(new Error("quota exhausted"));
    const service = new ImageModerationService({ apiKey: "", openaiApiKey: "test" });
    await expect(service.reviewImage(Buffer.from("image"))).rejects.toThrow(ImageModerationUnavailableError);
  });
});
