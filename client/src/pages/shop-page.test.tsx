/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShopPage } from "./shop-page";
import type { ShopRecommendResponse } from "../types";

vi.mock("../context/auth-context", () => ({
  useAuth: () => ({
    token: "test-token",
    user: {
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      picture: null
    }
  })
}));

const apiMocks = vi.hoisted(() => ({
  shopRecommend: vi.fn(),
  shopTryOn: vi.fn()
}));

vi.mock("../lib/api", () => apiMocks);

const recommendationPayload: ShopRecommendResponse = {
  product: {
    key: "user-1/online-items/product.png",
    imageUrl: "https://cdn.example.com/user-1/online-items/product.png",
    name: "Striped Shirt",
    category: "tops",
    tags: ["striped", "cotton"],
    description: "A striped cotton shirt."
  },
  outfits: [
    {
      styleNote: "A relaxed weekend outfit.",
      items: [
        {
          id: "user-1/online-items/product.png",
          category: "tops",
          name: "Striped Shirt",
          imageUrl: "https://cdn.example.com/user-1/online-items/product.png",
          tags: ["striped"],
          description: "A striped cotton shirt.",
          isUserSelected: true,
          reason: null
        },
        {
          id: "shoe-1",
          category: "shoes",
          name: "White Sneakers",
          imageUrl: "https://cdn.example.com/closet/shoe-1.jpg",
          tags: ["casual"],
          description: "Clean white sneakers.",
          isUserSelected: false,
          reason: "They keep the look casual."
        }
      ]
    }
  ]
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderShopPage() {
  const rendered = render(<ShopPage />);
  const input = rendered.container.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error("Expected product image file input to render.");
  }
  return { ...rendered, input };
}

async function uploadProductImage(input: HTMLInputElement) {
  const user = userEvent.setup();
  const file = new File(["fake-image"], "product.png", { type: "image/png" });
  await user.upload(input, file);
  return { user, file };
}

async function renderRecommendations() {
  apiMocks.shopRecommend.mockResolvedValue(recommendationPayload);
  const { input } = renderShopPage();
  const { user, file } = await uploadProductImage(input);
  await user.click(screen.getByRole("button", { name: "Find Outfits" }));

  await screen.findByText("Outfit Recommendations for");
  await screen.findByRole("button", { name: "Generate Try-On" });
  return { user, file };
}

describe("ShopPage product upload and recommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:product-preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("renders the initial product upload area", () => {
    renderShopPage();

    expect(screen.getByRole("heading", { name: "Shop New Item" })).toBeInTheDocument();
    expect(screen.getByText(/drag and drop a product photo here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose File" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find Outfits" })).toBeDisabled();
  });

  it("shows a loading state after uploading an image and requesting recommendations", async () => {
    const pendingRecommendations = deferred<ShopRecommendResponse>();
    apiMocks.shopRecommend.mockReturnValue(pendingRecommendations.promise);
    const { input } = renderShopPage();
    const { user, file } = await uploadProductImage(input);

    await user.click(screen.getByRole("button", { name: "Find Outfits" }));

    expect(apiMocks.shopRecommend).toHaveBeenCalledWith("test-token", file);
    expect(screen.getByRole("button", { name: "Finding outfits..." })).toBeDisabled();
    expect(screen.getByText(/analyzing your item and finding matching outfits/i)).toBeInTheDocument();

    pendingRecommendations.resolve(recommendationPayload);
    await screen.findByText("Outfit Recommendations for");
  });

  it("renders recommendation cards returned from the product recommendation request", async () => {
    await renderRecommendations();

    expect(screen.getByText("A relaxed weekend outfit.")).toBeInTheDocument();
    expect(screen.getByText("White Sneakers")).toBeInTheDocument();
    expect(screen.getByText("They keep the look casual.")).toBeInTheDocument();
    expect(screen.getByText("New item")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Try-On" })).toBeInTheDocument();
  });

  it("shows an error state when the recommendation request fails", async () => {
    apiMocks.shopRecommend.mockRejectedValue(new Error("Failed to get shop recommendations."));
    const { input } = renderShopPage();
    const { user } = await uploadProductImage(input);

    await user.click(screen.getByRole("button", { name: "Find Outfits" }));

    expect(await screen.findByText("Failed to get shop recommendations.")).toBeInTheDocument();
    expect(screen.queryByText("Outfit Recommendations for")).not.toBeInTheDocument();
  });
});

describe("ShopPage try-on button flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:product-preview")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("shows loading state and displays the generated try-on image on success", async () => {
    const pendingTryOn = deferred<string>();
    apiMocks.shopTryOn.mockReturnValue(pendingTryOn.promise);
    const { user } = await renderRecommendations();

    await user.click(screen.getByRole("button", { name: "Generate Try-On" }));

    expect(apiMocks.shopTryOn).toHaveBeenCalledWith(
      "test-token",
      "user-1/online-items/product.png",
      ["shoe-1"],
      "A relaxed weekend outfit.",
      "Striped Shirt"
    );
    expect(screen.getByText("Generating try-on image...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generating..." })).toBeDisabled();

    pendingTryOn.resolve("https://cdn.example.com/generated/shop-tryon.png");

    const generatedImage = await screen.findByAltText("Try-on for outfit 1");
    expect(generatedImage).toHaveAttribute("src", "https://cdn.example.com/generated/shop-tryon.png");
    expect(screen.getByRole("button", { name: "Regenerate Try-On" })).toBeInTheDocument();
  });

  it("shows the profile prompt when try-on fails because the user has no full-body photo", async () => {
    apiMocks.shopTryOn.mockRejectedValue(
      new Error("You need to upload a full-body photo in your profile before generating a try-on image.")
    );
    const { user } = await renderRecommendations();

    await user.click(screen.getByRole("button", { name: "Generate Try-On" }));

    expect(
      await screen.findByText("You need to upload a full-body photo in your profile before generating a try-on image.")
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Generate Try-On" })).toBeEnabled();
    });
  });
});
