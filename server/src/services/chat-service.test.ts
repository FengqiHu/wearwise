import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService, type WardrobeItem } from "./chat-service.js";
import { OpenWeatherService } from "./openweather-service.js";

// Minimal fake runner returned by runTools.
function makeFakeRunner(onContent?: string) {
  return {
    on: vi.fn((event: string, cb: (chunk: string) => void) => {
      if (event === "content" && onContent) cb(onContent);
    }),
    done: vi.fn().mockResolvedValue(undefined),
    messages: []
  };
}

// Captured tools from the most recent runTools call.
let capturedTools: Array<{
  function: {
    name: string;
    parse: (raw: string) => unknown;
    function: (args: unknown) => Promise<unknown>;
  };
}> = [];

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        runTools: vi.fn((params: { tools: typeof capturedTools }) => {
          capturedTools = params.tools as typeof capturedTools;
          return makeFakeRunner();
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

function makeChatService(): ChatService {
  return new ChatService("test-api-key", new OpenWeatherService(""));
}

function makeWardrobeItems(overrides: Partial<WardrobeItem>[] = []): WardrobeItem[] {
  return [
    { id: "item-1", name: "Black Polo Shirt", category: "tops" },
    { id: "item-2", name: "Slim Fit Jeans", category: "pants" },
    ...overrides.map((o) => ({ id: "extra", name: "Extra Item", category: "tops", ...o }))
  ];
}

async function invokeToolByName(name: string, rawArgs: string): Promise<unknown> {
  const tool = capturedTools.find((t) => t.function.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  const parsed = tool.function.parse(rawArgs);
  return tool.function.function(parsed);
}

async function runStreamChat(wardrobeItems: WardrobeItem[]): Promise<void> {
  const service = makeChatService();
  await service.streamChat({
    messages: [{ role: "user", content: "Suggest an outfit." }],
    onChunk: vi.fn(),
    wardrobeItems
  });
}

describe("find_wardrobe_item tool (#325)", () => {
  beforeEach(async () => {
    capturedTools = [];
    await runStreamChat(makeWardrobeItems());
  });

  it("returns matching items for a partial name match", async () => {
    const result = await invokeToolByName("find_wardrobe_item", JSON.stringify({ name: "polo" }));
    expect(result).toEqual({
      found: true,
      items: [{ id: "item-1", name: "Black Polo Shirt", category: "tops" }]
    });
  });

  it("is case-insensitive", async () => {
    const result = await invokeToolByName("find_wardrobe_item", JSON.stringify({ name: "SLIM" }));
    expect(result).toEqual({
      found: true,
      items: [{ id: "item-2", name: "Slim Fit Jeans", category: "pants" }]
    });
  });

  it("returns multiple matches when more than one item matches", async () => {
    await runStreamChat([
      { id: "a", name: "Blue Denim Jacket", category: "outerwear" },
      { id: "b", name: "Blue Oxford Shirt", category: "tops" },
      { id: "c", name: "Black Polo", category: "tops" }
    ]);
    const result = await invokeToolByName("find_wardrobe_item", JSON.stringify({ name: "blue" })) as { found: boolean; items: unknown[] };
    expect(result.found).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  it("returns { found: false } when no items match", async () => {
    const result = await invokeToolByName("find_wardrobe_item", JSON.stringify({ name: "tuxedo" }));
    expect(result).toEqual({ found: false, message: "No wardrobe items matched that name." });
  });

  it("returns { found: false } when wardrobeItems is empty", async () => {
    await runStreamChat([]);
    const result = await invokeToolByName("find_wardrobe_item", JSON.stringify({ name: "polo" }));
    expect(result).toEqual({ found: false, message: "No wardrobe items matched that name." });
  });
});

describe("submit_outfit ID validation (#325)", () => {
  const onOutfit = vi.fn();

  beforeEach(async () => {
    capturedTools = [];
    onOutfit.mockReset();
    const service = makeChatService();
    await service.streamChat({
      messages: [{ role: "user", content: "Suggest an outfit." }],
      onChunk: vi.fn(),
      onOutfit,
      wardrobeItems: makeWardrobeItems()
    });
  });

  it("returns { ok: true } when all item IDs are valid", async () => {
    const result = await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "Casual Look",
        reason: "Great for weekends",
        items: [
          { id: "item-1", name: "Black Polo Shirt" },
          { id: "item-2", name: "Slim Fit Jeans" }
        ]
      })
    );
    expect(result).toEqual({ ok: true, submitted: "Casual Look" });
    expect(onOutfit).toHaveBeenCalledOnce();
  });

  it("returns { ok: false } and does not call onOutfit when any item ID is invalid", async () => {
    const result = await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "Bad Outfit",
        reason: "Has a hallucinated item",
        items: [
          { id: "item-1", name: "Black Polo Shirt" },
          { id: "placeholder", name: "Unknown Item" }
        ]
      })
    ) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('"placeholder"');
    expect(result.error).toContain("find_wardrobe_item");
    expect(onOutfit).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when all item IDs are invalid", async () => {
    const result = await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "All Wrong",
        reason: "Every ID is hallucinated",
        items: [{ id: "fake-1", name: "Fake Shirt" }]
      })
    ) as { ok: boolean };

    expect(result.ok).toBe(false);
    expect(onOutfit).not.toHaveBeenCalled();
  });

  it("skips validation and calls onOutfit when wardrobeItems is not provided", async () => {
    capturedTools = [];
    const service = makeChatService();
    const onOutfitNoWardrobe = vi.fn();
    await service.streamChat({
      messages: [{ role: "user", content: "Suggest an outfit." }],
      onChunk: vi.fn(),
      onOutfit: onOutfitNoWardrobe
    });

    await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "Unchecked Outfit",
        reason: "No wardrobe to validate against",
        items: [{ id: "any-id", name: "Any Item" }]
      })
    );

    expect(onOutfitNoWardrobe).toHaveBeenCalledOnce();
  });
});
