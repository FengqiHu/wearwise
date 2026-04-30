import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WardrobePage } from "./wardrobe-page";
import type { ClothingItem } from "../types";

vi.mock("../context/auth-context", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { id: "u1", name: "Alex", email: "alex@example.com", picture: null },
    profile: null
  })
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const apiMocks = vi.hoisted(() => ({
  fetchClosetItems: vi.fn(),
  deleteClosetItem: vi.fn(),
  recommendOutfit: vi.fn(),
  generateOutfitByItems: vi.fn()
}));

vi.mock("../lib/api", () => apiMocks);

function makeItem(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id: "item-1",
    title: "Blue Oxford Shirt",
    imageUrl: "https://cdn.example.com/item-1.jpg",
    category: "tops",
    tags: ["blue", "cotton"],
    description: "A casual blue shirt",
    status: "finished",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function renderWardrobe() {
  return render(
    <MemoryRouter>
      <WardrobePage />
    </MemoryRouter>
  );
}

describe("WardrobePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
    apiMocks.fetchClosetItems.mockResolvedValue([]);
    apiMocks.deleteClosetItem.mockResolvedValue(undefined);
    apiMocks.recommendOutfit.mockResolvedValue({ outfit: [], styleNote: "" });
  });

  describe("loading and empty state", () => {
    it("shows empty state when wardrobe has no items", async () => {
      apiMocks.fetchClosetItems.mockResolvedValue([]);
      renderWardrobe();

      await waitFor(() => {
        expect(screen.getByText(/No items found for this filter/i)).toBeInTheDocument();
      });
    });

    it("fetches closet items on mount", async () => {
      renderWardrobe();
      await waitFor(() => {
        expect(apiMocks.fetchClosetItems).toHaveBeenCalledOnce();
      });
    });
  });

  describe("item list rendering", () => {
    it("renders item titles when wardrobe has items", async () => {
      apiMocks.fetchClosetItems.mockResolvedValue([
        makeItem({ id: "item-1", title: "Blue Oxford Shirt" }),
        makeItem({ id: "item-2", title: "Slim Fit Jeans", category: "pants" })
      ]);
      renderWardrobe();

      await waitFor(() => {
        expect(screen.getByText("Blue Oxford Shirt")).toBeInTheDocument();
        expect(screen.getByText("Slim Fit Jeans")).toBeInTheDocument();
      });
    });

    it("renders item categories as badges", async () => {
      apiMocks.fetchClosetItems.mockResolvedValue([
        makeItem({ id: "item-1", title: "Blue Shirt", category: "tops" })
      ]);
      renderWardrobe();

      await waitFor(() => {
        expect(screen.getByText("tops")).toBeInTheDocument();
      });
    });
  });

  describe("category filter", () => {
    it("shows all items when 'All' filter is active", async () => {
      apiMocks.fetchClosetItems.mockResolvedValue([
        makeItem({ id: "item-1", title: "Blue Shirt", category: "tops" }),
        makeItem({ id: "item-2", title: "Slim Jeans", category: "pants" })
      ]);
      renderWardrobe();

      await waitFor(() => {
        expect(screen.getByText("Blue Shirt")).toBeInTheDocument();
        expect(screen.getByText("Slim Jeans")).toBeInTheDocument();
      });
    });

    it("filters items by category when a filter button is clicked", async () => {
      apiMocks.fetchClosetItems.mockResolvedValue([
        makeItem({ id: "item-1", title: "Blue Shirt", category: "tops" }),
        makeItem({ id: "item-2", title: "Slim Jeans", category: "pants" })
      ]);
      renderWardrobe();

      await waitFor(() => {
        expect(screen.getByText("Blue Shirt")).toBeInTheDocument();
      });

      const topsFilter = screen.getByRole("button", { name: /^tops$/i });
      await userEvent.click(topsFilter);

      expect(screen.getByText("Blue Shirt")).toBeInTheDocument();
      expect(screen.queryByText("Slim Jeans")).not.toBeInTheDocument();
    });
  });

  describe("item navigation", () => {
    it("navigates to item detail page when an item card is clicked", async () => {
      apiMocks.fetchClosetItems.mockResolvedValue([
        makeItem({ id: "item-1", title: "Blue Shirt" })
      ]);
      renderWardrobe();

      await waitFor(() => {
        expect(screen.getByText("Blue Shirt")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Blue Shirt"));
      expect(mockNavigate).toHaveBeenCalledWith("/cloth/item-1");
    });
  });
});
