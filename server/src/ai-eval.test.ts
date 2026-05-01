/**
 * AI Evaluation Suite
 *
 * Golden prompt tests for all AI components in WearWise.
 * Each describe block validates that the prompt sent to the model
 * encodes the correct behavioral constraints for that component.
 *
 * Coverage map:
 *   - Wardrobe system message  → buildWardrobeSystemMessage (chat-routes.ts)
 *   - Developer instructions   → buildDeveloperInstructions (chat-service.ts)
 *   - Style summary prompt     → buildStyleSummaryPrompt (gemini-recommendation-service.ts)
 *   - Try-on image prompt      → buildMainPrompt (image-generation-service.ts)
 *   - Outfit recommendation    → buildRecommendationPrompt (gemini-recommendation-service.ts)
 *   - Shop recommendation      → buildShopOutfitsPrompt (gemini-recommendation-service.ts)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWardrobeSystemMessage } from "./routes/chat-routes.js";
import { buildDeveloperInstructions } from "./services/chat-service.js";
import {
  buildStyleSummaryPrompt,
  buildRecommendationPrompt,
  buildShopOutfitsPrompt,
  GeminiRecommendationService,
  type VotedOutfit,
  type RecommendOutfitInput,
  type RecommendationItemContext,
  type OutfitCategory
} from "./services/gemini-recommendation-service.js";
import { buildMainPrompt } from "./services/image-generation-service.js";
import type { ClosetItemRecord, UserProfile, AccessoryMode, PendingConfirmation } from "./types/domain.js";
import type { PrefetchedContext } from "./services/chat-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ClosetItemRecord> = {}): ClosetItemRecord {
  return {
    id: "item-1",
    userId: "user-1",
    imageUrl: "https://example.com/item.jpg",
    analysisStatus: "ready",
    analysisError: null,
    name: "Blue Oxford Shirt",
    category: "tops",
    tags: ["blue", "cotton"],
    description: "Lightweight blue oxford shirt",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    name: "Taylor",
    heightCm: 175,
    weightKg: 65,
    styleNote: "",
    avatarUrl: null,
    fullBodyImageUrl: null,
    headshotImageUrl: null,
    ...overrides
  };
}

function wardrobePrompt(
  items: ClosetItemRecord[],
  opts: {
    profile?: UserProfile | null;
    mode?: AccessoryMode;
    pending?: PendingConfirmation;
    timezone?: string;
    presetContext?: PrefetchedContext;
    hasUserLocation?: boolean;
  } = {}
): string {
  return buildWardrobeSystemMessage(
    opts.profile !== undefined ? opts.profile : null,
    items,
    opts.mode ?? "auto",
    opts.pending,
    opts.timezone,
    opts.presetContext,
    opts.hasUserLocation
  );
}

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

function makeRecommendInput(overrides: Partial<RecommendOutfitInput> = {}): RecommendOutfitInput {
  return {
    selectedItems: [
      { id: "top-1", category: "tops", name: "Blue Shirt", tags: ["blue", "cotton"], description: "A blue shirt" }
    ],
    missingCategories: ["pants", "shoes"],
    candidatesByCategory: {
      pants: [{ id: "pants-1", category: "pants", name: "Slim Jeans", tags: ["blue"], description: "Slim jeans" }],
      shoes: [{ id: "shoes-1", category: "shoes", name: "White Sneakers", tags: ["white"], description: "Clean sneakers" }]
    },
    ...overrides
  };
}

function makeShopInput(): {
  productItem: RecommendationItemContext;
  wardrobeByCategory: Partial<Record<OutfitCategory, RecommendationItemContext[]>>;
} {
  return {
    productItem: {
      id: "product-1",
      category: "tops",
      name: "Linen Blazer",
      tags: ["beige", "linen"],
      description: "A lightweight beige linen blazer"
    },
    wardrobeByCategory: {
      pants: [{ id: "pants-1", category: "pants", name: "Slim Chinos", tags: ["navy"], description: "Navy chinos" }],
      shoes: [{ id: "shoes-1", category: "shoes", name: "Brown Loafers", tags: ["brown"], description: "Brown loafers" }]
    }
  };
}

// ---------------------------------------------------------------------------
// AI Eval — Wardrobe System Message
// ---------------------------------------------------------------------------

describe("AI Eval — Wardrobe System Message", () => {
  describe("wardrobe item formatting", () => {
    it("includes item ID, name, category, and tags for each ready item", () => {
      const items = [makeItem({ id: "top-1", name: "Linen Shirt", category: "tops", tags: ["beige", "linen"] })];
      const prompt = wardrobePrompt(items);
      expect(prompt).toContain("ID: top-1");
      expect(prompt).toContain("Name: Linen Shirt");
      expect(prompt).toContain("Category: tops");
      expect(prompt).toContain("beige, linen");
    });

    it("shows wardrobe item count in the section header", () => {
      const items = [
        makeItem({ id: "a", name: "Shirt" }),
        makeItem({ id: "b", name: "Pants", category: "pants" })
      ];
      const prompt = wardrobePrompt(items);
      expect(prompt).toContain("Wardrobe (2 items):");
    });

    it("shows 'no clothing items available' when wardrobe is empty", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("no clothing items available");
    });

    it("excludes pending and error items from the wardrobe section", () => {
      const items = [
        makeItem({ id: "ready-1", name: "Ready Shirt", analysisStatus: "ready" }),
        makeItem({ id: "pending-1", name: "Pending Pants", analysisStatus: "pending" }),
        makeItem({ id: "error-1", name: "Error Coat", analysisStatus: "error" })
      ];
      const prompt = wardrobePrompt(items);
      expect(prompt).toContain("Wardrobe (1 items):");
      expect(prompt).toContain("Ready Shirt");
      expect(prompt).not.toContain("Pending Pants");
      expect(prompt).not.toContain("Error Coat");
    });
  });

  describe("user profile", () => {
    it("includes height, weight, and name from profile", () => {
      const prompt = wardrobePrompt([], { profile: makeProfile({ heightCm: 180, weightKg: 75, name: "Alex" }) });
      expect(prompt).toContain("- Height: 180 cm");
      expect(prompt).toContain("- Weight: 75 kg");
      expect(prompt).toContain("Alex");
    });

    it("includes sex when set on the profile", () => {
      const prompt = wardrobePrompt([], { profile: makeProfile({ sex: "female" }) });
      expect(prompt).toContain("- Sex: female");
    });

    it("shows 'not specified' for sex when profile has no sex", () => {
      const profile = makeProfile();
      delete profile.sex;
      const prompt = wardrobePrompt([], { profile });
      expect(prompt).toContain("- Sex: not specified");
    });

    it("shows 'not set up yet' when profile is null", () => {
      const prompt = wardrobePrompt([], { profile: null });
      expect(prompt).toContain("not set up yet");
    });

    it("includes active styleNote instruction in Step 4 when styleNote is set", () => {
      const prompt = wardrobePrompt([], {
        profile: makeProfile({ styleNote: "I prefer casual cotton tops and slim-fit pants" })
      });
      expect(prompt).toContain("Style preferences (apply actively)");
      expect(prompt).toContain("I prefer casual cotton tops and slim-fit pants");
      expect(prompt).toContain("Prioritize combinations");
      expect(prompt).toContain("Avoid patterns");
    });

    it("omits style preference instruction when styleNote is empty", () => {
      const prompt = wardrobePrompt([], { profile: makeProfile({ styleNote: "" }) });
      expect(prompt).not.toContain("Style preferences (apply actively)");
      expect(prompt).not.toContain("Prioritize combinations");
    });

    it("omits style preference instruction when profile is null", () => {
      const prompt = wardrobePrompt([], { profile: null });
      expect(prompt).not.toContain("Style preferences (apply actively)");
    });
  });

  describe("accessory mode", () => {
    it('excludes accessories from wardrobe context when mode is "exclude"', () => {
      const items = [
        makeItem({ id: "top-1", name: "Ready Shirt", category: "tops" }),
        makeItem({ id: "acc-1", name: "Silver Watch", category: "accessories" })
      ];
      const prompt = wardrobePrompt(items, { mode: "exclude" });
      expect(prompt).toContain("Wardrobe (1 items):");
      expect(prompt).toContain("Ready Shirt");
      expect(prompt).not.toContain("Silver Watch");
      expect(prompt).toContain("Do NOT include any accessories");
    });

    it('requires accessories in every outfit when mode is "include"', () => {
      const items = [
        makeItem({ id: "top-1", name: "Ready Shirt", category: "tops" }),
        makeItem({ id: "acc-1", name: "Silver Watch", category: "accessories" })
      ];
      const prompt = wardrobePrompt(items, { mode: "include" });
      expect(prompt).toContain("Silver Watch");
      expect(prompt).toContain("Every outfit MUST include at least one accessory item");
    });

    it('leaves accessory choice to AI judgment when mode is "auto"', () => {
      const prompt = wardrobePrompt([], { mode: "auto" });
      expect(prompt).toContain("Use your own judgment on whether to include accessories");
    });
  });

  describe("outfit generation rules", () => {
    it("instructs the model to use only wardrobe items with their exact IDs", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Only use items from the wardrobe list above, with their exact IDs");
    });

    it("instructs the model to call submit_outfit rather than output a JSON code block", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("submit_outfit tool once per outfit");
      expect(prompt).toContain("Do NOT output a JSON code block for outfits");
    });

    it("instructs the model to infer outfit count from the conversation", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Infer the number of outfits");
      expect(prompt).not.toContain("Always include exactly 3");
    });

    it("specifies default of 3 and maximum of 5", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Default to 3");
      expect(prompt).toContain("Maximum is 5");
    });

    it("enforces at most one item per category per outfit", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Each outfit may contain at most one item per category");
    });
  });

  describe("style compatibility rules", () => {
    it("includes all three style compatibility rules", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Formality");
      expect(prompt).toContain("formality level");
      expect(prompt).toContain("Color coordination");
      expect(prompt).toContain("complementary");
      expect(prompt).toContain("Occasion fit");
      expect(prompt).toContain("dress code");
    });
  });

  describe("pre-recommendation checklist", () => {
    it("includes the pre-recommendation checklist header", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Pre-recommendation checklist");
    });

    it("instructs the model to call get_weather for live weather data", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("get_weather");
    });

    it("instructs the model to call get_current_time for local time", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("get_current_time");
    });

    it("uses pre-fetched weather and skips get_weather when presetContext has weatherSummary", () => {
      const prompt = wardrobePrompt([], {
        presetContext: { weatherSummary: "Baltimore - 13°C - rainy", currentTime: null, locationLabel: "Baltimore" },
        hasUserLocation: true
      });
      expect(prompt).toContain("Baltimore - 13°C - rainy");
      expect(prompt).toContain("Do NOT call get_weather");
    });

    it("instructs to call get_weather with user location when location is available", () => {
      const prompt = wardrobePrompt([], { hasUserLocation: true });
      expect(prompt).toContain("Location is available");
      expect(prompt).toContain("Call get_weather with the user's location");
    });

    it("instructs to call get_user_location when no location is available", () => {
      const prompt = wardrobePrompt([], { hasUserLocation: false });
      expect(prompt).toContain("Location is not available from the browser");
      expect(prompt).toContain("get_user_location");
    });

    it("includes the user timezone in Step 2 when provided", () => {
      const prompt = wardrobePrompt([], { timezone: "America/New_York" });
      expect(prompt).toContain("America/New_York");
    });

    it("uses fallback timezone instruction when no timezone is provided", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("If you obtained a timezone in Step 1, call get_current_time");
    });

    it("includes tonight-or-tomorrow timing clarification in Step 3", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("tonight or tomorrow");
    });

    it("includes combined city-and-occasion fallback question in Step 1", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("What city are you in, and what are you dressing for?");
    });

    it("uses daytime range 00:00–17:59 and evening range 18:00–23:59 in Step 3", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("00:00–17:59");
      expect(prompt).toContain("18:00–23:59");
    });
  });

  describe("accessory mode intent recognition", () => {
    it("includes intent-recognition flow instructions", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Accessory Mode Intent Recognition");
      expect(prompt).toContain("set_accessory_mode");
      expect(prompt).toContain("(a) include accessories");
      expect(prompt).toContain("(b) exclude accessories");
      expect(prompt).toContain("(c) let me decide");
    });

    it("reflects addAccessoriesOffer pending state in the prompt", () => {
      const pending: PendingConfirmation = { type: "addAccessoriesOffer", createdAt: "2026-04-01T00:00:00.000Z" };
      const prompt = wardrobePrompt([], { pending });
      expect(prompt).toContain("Pending confirmation state for this conversation: addAccessoriesOffer");
      expect(prompt).toContain("Add-accessories-back flow");
      expect(prompt).toContain("add_accessories_to_recommendation");
    });

    it("shows 'none' for pending confirmation when no pending state exists", () => {
      const prompt = wardrobePrompt([]);
      expect(prompt).toContain("Pending confirmation state for this conversation: none");
    });
  });
});

// ---------------------------------------------------------------------------
// AI Eval — Developer Instructions
// ---------------------------------------------------------------------------

describe("AI Eval — Developer Instructions", () => {
  it("instructs the LLM never to include ISO timestamps in responses", () => {
    const instructions = buildDeveloperInstructions("2026-04-29");
    expect(instructions).toContain("Never include ISO timestamps or date prefixes in your responses");
  });

  it("instructs the LLM never to expose internal reasoning or thinking steps", () => {
    const instructions = buildDeveloperInstructions("2026-04-29");
    expect(instructions).toContain("Never expose your internal reasoning or thinking steps");
  });

  it("instructs the LLM to use get_weather instead of answering from memory", () => {
    const instructions = buildDeveloperInstructions("2026-04-29");
    expect(instructions).toContain("use the get_weather tool instead of answering from memory");
  });

  it("instructs the LLM to convert relative dates to YYYY-MM-DD before calling tools", () => {
    const instructions = buildDeveloperInstructions("2026-04-29");
    expect(instructions).toContain("convert it to an exact YYYY-MM-DD date before calling the tool");
  });

  it("instructs the LLM not to claim it lacks internet access when the weather tool is available", () => {
    const instructions = buildDeveloperInstructions("2026-04-29");
    expect(instructions).toContain("Never say that you do not have live internet access when the weather tool can answer the request");
  });

  it("injects today's date into the instructions", () => {
    const instructions = buildDeveloperInstructions("2026-04-29");
    expect(instructions).toContain("2026-04-29");
  });
});

// ---------------------------------------------------------------------------
// AI Eval — Style Summary Prompt (Gemini)
// ---------------------------------------------------------------------------

describe("AI Eval — Style Summary Prompt (Gemini)", () => {
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

  it("handles outfits with no items without crashing", () => {
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

// ---------------------------------------------------------------------------
// AI Eval — Try-on Image Prompt
// ---------------------------------------------------------------------------

describe("AI Eval — Try-on Image Prompt", () => {
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
    const prompt = buildMainPrompt({ occasions: ["work meeting"], weatherSummary: "20°C, sunny" });
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

// ---------------------------------------------------------------------------
// AI Eval — Outfit Recommendation Prompt (Gemini)
// ---------------------------------------------------------------------------

describe("AI Eval — Outfit Recommendation Prompt (Gemini)", () => {
  it("identifies the model as a professional fashion stylist assistant", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("You are a professional fashion stylist assistant.");
  });

  it("instructs the model to pick exactly one item per missing category", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("pick exactly one item per missing category");
  });

  it("serializes selectedItems into the prompt context", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("top-1");
    expect(prompt).toContain("Blue Shirt");
  });

  it("serializes missingCategories into the prompt context", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("pants");
    expect(prompt).toContain("shoes");
  });

  it("serializes candidatesByCategory into the prompt context", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("pants-1");
    expect(prompt).toContain("Slim Jeans");
    expect(prompt).toContain("shoes-1");
    expect(prompt).toContain("White Sneakers");
  });

  it("instructs the model never to invent or modify item IDs", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("Never invent or modify item IDs");
  });

  it("instructs the model to include a styleNote", () => {
    const prompt = buildRecommendationPrompt(makeRecommendInput());
    expect(prompt).toContain("styleNote");
  });
});

// ---------------------------------------------------------------------------
// AI Eval — Shop Recommendation Prompt (Gemini)
// ---------------------------------------------------------------------------

describe("AI Eval — Shop Recommendation Prompt (Gemini)", () => {
  it("identifies the model as a professional fashion stylist assistant", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("You are a professional fashion stylist assistant.");
  });

  it("includes the product item details in the prompt", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("product-1");
    expect(prompt).toContain("Linen Blazer");
  });

  it("includes wardrobe candidates in the prompt", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("pants-1");
    expect(prompt).toContain("Slim Chinos");
    expect(prompt).toContain("shoes-1");
    expect(prompt).toContain("Brown Loafers");
  });

  it("injects the product category into the duplicate-category rule", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("The product's category is 'tops'");
    expect(prompt).toContain("do NOT add wardrobe items in the same category");
  });

  it("instructs the model to suggest 1-3 distinct outfit combinations", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("1-3 distinct outfit combinations");
  });

  it("instructs the model never to invent item IDs", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("Never invent IDs");
  });

  it("instructs the model to include a styleNote per outfit", () => {
    const prompt = buildShopOutfitsPrompt(makeShopInput());
    expect(prompt).toContain("styleNote");
  });
});

// ---------------------------------------------------------------------------
// GeminiRecommendationService — structured logging behavior
// ---------------------------------------------------------------------------

describe("GeminiRecommendationService logging", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("emits ok:true log after summarizeStyle succeeds", async () => {
    const fakeAi = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: "I prefer casual styles." })
      }
    };
    const service = new GeminiRecommendationService({ apiKey: "test-key" });
    (service as unknown as { ai: typeof fakeAi }).ai = fakeAi;

    await service.summarizeStyle([{
      outfitName: "Casual Look",
      items: [{ id: "item-1", name: "Blue Shirt", category: "tops", tags: ["blue"] }],
      vote: "up",
      updatedAt: new Date().toISOString()
    }]);

    const logged = consoleSpy.mock.calls.map((args: unknown[]) => JSON.parse(args[0] as string) as Record<string, unknown>);
    const successLog = logged.find((l: Record<string, unknown>) => l["op"] === "summarizeStyle" && l["ok"] === true);
    expect(successLog).toBeDefined();
    expect(successLog).toMatchObject({ service: "gemini", op: "summarizeStyle", ok: true });
    expect(typeof successLog!["latencyMs"]).toBe("number");
    expect(typeof successLog!["traceId"]).toBe("string");
  });

  it("emits ok:false log when the Gemini API throws during summarizeStyle", async () => {
    const fakeAi = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("API unavailable"))
      }
    };
    const service = new GeminiRecommendationService({ apiKey: "test-key" });
    (service as unknown as { ai: typeof fakeAi }).ai = fakeAi;

    await expect(service.summarizeStyle([{
      outfitName: "Casual Look",
      items: [],
      vote: "up",
      updatedAt: new Date().toISOString()
    }])).rejects.toThrow("API unavailable");

    const logged = consoleSpy.mock.calls.map((args: unknown[]) => JSON.parse(args[0] as string) as Record<string, unknown>);
    const failLog = logged.find((l: Record<string, unknown>) => l["op"] === "summarizeStyle" && l["ok"] === false);
    expect(failLog).toBeDefined();
    expect(failLog).toMatchObject({ service: "gemini", op: "summarizeStyle", ok: false });
    expect(typeof failLog!["error"]).toBe("string");
  });
});
