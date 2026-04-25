import { describe, expect, it } from "vitest";
import { buildStyleSummaryPrompt, type VotedOutfit } from "./gemini-recommendation-service.js";

function makeVotedOutfit(overrides: Partial<VotedOutfit> = {}): VotedOutfit {
  return {
    outfitName: "Casual Look",
    items: [
      { id: "item-1", name: "Blue Oxford Shirt", category: "tops", tags: ["blue", "cotton"] },
      { id: "item-2", name: "Slim Chinos", category: "pants", tags: ["beige", "casual"] }
    ],
    vote: "up",
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("buildStyleSummaryPrompt", () => {
  it("includes item category and tags in liked outfit lines", () => {
    const prompt = buildStyleSummaryPrompt([makeVotedOutfit({ vote: "up" })]);

    expect(prompt).toContain("Liked outfits");
    expect(prompt).toContain("Blue Oxford Shirt");
    expect(prompt).toContain("tops");
    expect(prompt).toContain("blue, cotton");
    expect(prompt).toContain("Slim Chinos");
    expect(prompt).toContain("pants");
    expect(prompt).toContain("beige, casual");
  });

  it("includes item category and tags in disliked outfit lines", () => {
    const prompt = buildStyleSummaryPrompt([makeVotedOutfit({ vote: "down" })]);

    expect(prompt).toContain("Disliked outfits");
    expect(prompt).toContain("Blue Oxford Shirt");
    expect(prompt).toContain("tops");
    expect(prompt).toContain("blue, cotton");
  });

  it("separates liked and disliked outfits into their respective sections", () => {
    const liked = makeVotedOutfit({ outfitName: "Summer Set", vote: "up" });
    const disliked = makeVotedOutfit({ outfitName: "Formal Suit", vote: "down" });

    const prompt = buildStyleSummaryPrompt([liked, disliked]);

    const likedIdx = prompt.indexOf("Liked outfits");
    const dislikedIdx = prompt.indexOf("Disliked outfits");
    const summerIdx = prompt.indexOf("Summer Set");
    const formalIdx = prompt.indexOf("Formal Suit");

    expect(likedIdx).toBeGreaterThan(-1);
    expect(dislikedIdx).toBeGreaterThan(-1);
    expect(summerIdx).toBeGreaterThan(likedIdx);
    expect(summerIdx).toBeLessThan(dislikedIdx);
    expect(formalIdx).toBeGreaterThan(dislikedIdx);
  });

  it("shows 'No liked outfits' when there are no upvotes", () => {
    const prompt = buildStyleSummaryPrompt([makeVotedOutfit({ vote: "down" })]);

    expect(prompt).toContain("No liked outfits");
  });

  it("shows 'No disliked outfits' when there are no downvotes", () => {
    const prompt = buildStyleSummaryPrompt([makeVotedOutfit({ vote: "up" })]);

    expect(prompt).toContain("No disliked outfits");
  });

  it("handles items with no tags gracefully", () => {
    const outfit = makeVotedOutfit({
      items: [{ id: "item-1", name: "Plain Tee", category: "tops", tags: [] }]
    });

    const prompt = buildStyleSummaryPrompt([outfit]);

    expect(prompt).toContain("Plain Tee");
    expect(prompt).toContain("tops");
    // no crash, no dangling brackets
    expect(prompt).not.toContain("[]");
  });

  it("handles items with null category gracefully", () => {
    const outfit = makeVotedOutfit({
      items: [{ id: "item-1", name: "Mystery Item", category: null, tags: ["vintage"] }]
    });

    const prompt = buildStyleSummaryPrompt([outfit]);

    expect(prompt).toContain("Mystery Item");
    expect(prompt).toContain("unknown");
    expect(prompt).toContain("vintage");
  });

  it("handles outfits with no items (all deleted) without crashing", () => {
    const outfit = makeVotedOutfit({ items: [] });

    const prompt = buildStyleSummaryPrompt([outfit]);

    expect(prompt).toContain("Casual Look");
    expect(prompt).toContain("no items available");
  });

  it("includes recency score in each outfit line", () => {
    const prompt = buildStyleSummaryPrompt([makeVotedOutfit()]);

    expect(prompt).toMatch(/recency: \d+\.\d+/);
  });
});
