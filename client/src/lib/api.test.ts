import { describe, expect, it, vi } from "vitest";
import { API_BASE_URL, generateOutfit } from "./api";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("generateOutfit", () => {
  it("sends the expected POST request and returns the generated image URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({
        success: true,
        result: {
          imageUrl: "https://example.com/generated-outfit.png",
          generatedAt: "2026-03-29T13:00:00.000Z"
        }
      })
    );
    const imageUrl = await generateOutfit("test-token", "rec-123");

    expect(imageUrl).toBe("https://example.com/generated-outfit.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE_URL}/api/generate/outfit`,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          recommendationId: "rec-123"
        })
      })
    );
  });

  it("throws a friendly error when the user has not uploaded a full-body photo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse(
        {
          message: "User has no body image."
        },
        422
      )
    );

    await expect(generateOutfit("test-token", "rec-123")).rejects.toThrow(
      "You need to upload a full-body photo in your profile before generating a try-on image."
    );
  });

  it("throws the server's message for other non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse(
        {
          message: "Recommendation not found."
        },
        404
      )
    );

    await expect(generateOutfit("test-token", "rec-123")).rejects.toThrow("Recommendation not found.");
  });

  it("throws the payload message when the response is 200 but generation still fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      createJsonResponse({
        success: false,
        result: null,
        message: "Image generation failed."
      })
    );

    await expect(generateOutfit("test-token", "rec-123")).rejects.toThrow("Image generation failed.");
  });
});
