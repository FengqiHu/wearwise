import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService, type SubmitOutfitArgs, type WardrobeItem } from "./chat-service.js";
import { OpenWeatherService } from "./openweather-service.js";

type OnOutfit = (outfit: SubmitOutfitArgs) => void | Promise<void>;

function makeFakeRunner() {
  return {
    on: vi.fn(),
    done: vi.fn().mockResolvedValue(undefined),
    messages: []
  };
}

let nextRunner: ReturnType<typeof makeFakeRunner> | null = null;

let capturedTools: Array<{
  function: {
    name: string;
    parse: (raw: string) => unknown;
    function: (args: unknown) => Promise<unknown>;
  };
}> = [];

let capturedDeveloperContent = "";

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        runTools: vi.fn((params: { tools: typeof capturedTools; messages: Array<{ role: string; content: string }> }) => {
          capturedTools = params.tools as typeof capturedTools;
          const devMsg = params.messages.find((m) => m.role === "developer");
          capturedDeveloperContent = devMsg?.content ?? "";
          const runner = nextRunner ?? makeFakeRunner();
          nextRunner = null;
          return runner;
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

async function runStreamChat(wardrobeItems: WardrobeItem[], onOutfit?: OnOutfit): Promise<void> {
  const service = makeChatService();
  await service.streamChat({
    messages: [{ role: "user", content: "Suggest an outfit." }],
    onChunk: vi.fn(),
    wardrobeItems,
    ...(onOutfit ? { onOutfit } : {})
  });
}

describe("find_wardrobe_item tool (#325)", () => {
  beforeEach(async () => {
    capturedTools = [];
    nextRunner = null;
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
  const onOutfit = vi.fn<OnOutfit>();

  beforeEach(async () => {
    capturedTools = [];
    nextRunner = null;
    onOutfit.mockReset();
    await runStreamChat(makeWardrobeItems(), onOutfit);
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
    const onOutfitNoWardrobe = vi.fn<OnOutfit>();
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

describe("submit_outfit category uniqueness validation (#325)", () => {
  const onOutfit = vi.fn<OnOutfit>();

  beforeEach(async () => {
    capturedTools = [];
    nextRunner = null;
    onOutfit.mockReset();
    await runStreamChat([
      { id: "shoe-1", name: "Timberland Boots", category: "shoes" },
      { id: "shoe-2", name: "Gray Sneakers", category: "shoes" },
      { id: "top-1", name: "Black Polo", category: "tops" },
      { id: "pants-1", name: "Gray Sweatpants", category: "pants" },
      { id: "acc-1", name: "Baseball Hat", category: "accessories" },
      { id: "acc-2", name: "Leather Bag", category: "accessories" }
    ], onOutfit);
  });

  it("returns { ok: false } when two items share the same category", async () => {
    const result = await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "Two Shoes Outfit",
        reason: "Has two pairs of shoes",
        items: [
          { id: "shoe-1", name: "Timberland Boots" },
          { id: "shoe-2", name: "Gray Sneakers" },
          { id: "top-1", name: "Black Polo" }
        ]
      })
    ) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('"shoes"');
    expect(result.error).toContain("at most one item per category");
    expect(onOutfit).not.toHaveBeenCalled();
  });

  it("returns { ok: true } when multiple accessories are included", async () => {
    const result = await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "Accessorized Look",
        reason: "Hat and bag are both accessories — allowed",
        items: [
          { id: "shoe-1", name: "Timberland Boots" },
          { id: "top-1", name: "Black Polo" },
          { id: "acc-1", name: "Baseball Hat" },
          { id: "acc-2", name: "Leather Bag" }
        ]
      })
    );
    expect(result).toEqual({ ok: true, submitted: "Accessorized Look" });
    expect(onOutfit).toHaveBeenCalledOnce();
  });

  it("returns { ok: true } when all items have unique categories", async () => {
    const result = await invokeToolByName(
      "submit_outfit",
      JSON.stringify({
        outfitName: "Valid Outfit",
        reason: "One item per category",
        items: [
          { id: "shoe-1", name: "Timberland Boots" },
          { id: "top-1", name: "Black Polo" },
          { id: "pants-1", name: "Gray Sweatpants" }
        ]
      })
    );

    expect(result).toEqual({ ok: true, submitted: "Valid Outfit" });
    expect(onOutfit).toHaveBeenCalledOnce();
  });
});

describe("streamChat reliability (#356)", () => {
  it("fails with a friendly AI service error when the OpenAI stream times out", async () => {
    nextRunner = {
      on: vi.fn(),
      done: vi.fn(() => new Promise<void>(() => {})),
      messages: []
    };
    const service = new ChatService(
      "test-api-key",
      new OpenWeatherService(""),
      { timeoutMs: 1 }
    );

    await expect(service.streamChat({
      messages: [{ role: "user", content: "Suggest an outfit." }],
      onChunk: vi.fn()
    })).rejects.toThrow("AI service is temporarily unavailable");
  });
});
