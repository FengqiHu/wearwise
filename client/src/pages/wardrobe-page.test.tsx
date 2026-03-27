import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WardrobePage } from "./wardrobe-page";
import type { ClothingItem } from "../types";

vi.mock("../context/auth-context", () => ({
  useAuth: () => ({
    token: "test-token"
  })
}));

const apiMocks = vi.hoisted(() => ({
  fetchClosetItems: vi.fn(),
  importTestClosetItems: vi.fn(),
  deleteClosetItem: vi.fn(),
  createPresignedImageUpload: vi.fn(),
  uploadFileToPresignedUrl: vi.fn()
}));

vi.mock("../lib/api", () => apiMocks);

const sampleItems = [
  {
    path: "sample-data/images/alpha-top.png",
    analysisStatus: "ready" as const,
    analysisError: null,
    name: "Alpha Top",
    category: "tops",
    tags: ["blue"],
    description: "Test top",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:01.000Z"
  },
  {
    path: "sample-data/images/beta-pants.jpg",
    analysisStatus: "ready" as const,
    analysisError: null,
    name: "Beta Pants",
    category: "pants",
    tags: ["black"],
    description: "Test pants",
    createdAt: "2026-03-25T10:00:02.000Z",
    updatedAt: "2026-03-25T10:00:03.000Z"
  }
];

describe("WardrobePage Add test data regression", () => {
  let wardrobeState: ClothingItem[];
  let importRound: number;

  beforeEach(() => {
    wardrobeState = [];
    importRound = 0;

    apiMocks.fetchClosetItems.mockImplementation(async () => [...wardrobeState]);

    apiMocks.importTestClosetItems.mockImplementation(async (_token, payload: { items: Array<{
      imageUrl: string;
      analysisStatus: "pending" | "ready" | "error";
      analysisError: string | null;
      name: string | null;
      category: string | null;
      tags: string[];
      description: string | null;
      createdAt?: string;
    }> }) => {
      importRound += 1;
      wardrobeState = payload.items.map((item, index) => ({
        id: `round-${importRound}-item-${index}`,
        title: item.name ?? "Processing...",
        category: (item.category ?? "tops") as ClothingItem["category"],
        tags: item.tags,
        description: item.description ?? "",
        imageUrl: item.imageUrl,
        status: item.analysisStatus === "ready" ? "finished" : "unfinished",
        createdAt: item.createdAt ?? `2026-03-25T10:00:0${index}.000Z`
      }));
    });

    apiMocks.deleteClosetItem.mockImplementation(async (_token, itemId: string) => {
      wardrobeState = wardrobeState.filter((item) => item.id !== itemId);
    });

    apiMocks.createPresignedImageUpload.mockImplementation(async (_token, payload: { fileName: string }) => ({
      uploadUrl: `https://upload.test/${payload.fileName}`,
      publicUrl: `https://public.test/${payload.fileName}`,
      key: `closet/${payload.fileName}`
    }));

    apiMocks.uploadFileToPresignedUrl.mockResolvedValue(undefined);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/sample-data/sample-clothes-data.json") {
        return new Response(JSON.stringify(sampleItems), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url === "/sample-data/images/alpha-top.png") {
        return new Response(new Blob(["alpha"], { type: "image/png" }), { status: 200 });
      }

      if (url === "/sample-data/images/beta-pants.jpg") {
        return new Response(new Blob(["beta"], { type: "image/jpeg" }), { status: 200 });
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });
  });

  it("re-imports test data successfully after deleting all imported items", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <WardrobePage />
      </MemoryRouter>
    );

    await screen.findByText("No items found for this filter.");

    await user.click(screen.getByRole("button", { name: "Add test data" }));

    await screen.findByText("2 test item(s) imported into your wardrobe.");
    expect(screen.getByText("Alpha Top")).toBeDefined();
    expect(screen.getByText("Beta Pants")).toBeDefined();

    for (const deleteButton of screen.getAllByLabelText("Delete item")) {
      await user.click(deleteButton);
    }

    await screen.findByText("No items found for this filter.");

    await user.click(screen.getByRole("button", { name: "Add test data" }));

    await screen.findByText("2 test item(s) imported into your wardrobe.");
    expect(screen.getByText("Alpha Top")).toBeDefined();
    expect(screen.getByText("Beta Pants")).toBeDefined();

    await waitFor(() => {
      expect(apiMocks.importTestClosetItems).toHaveBeenCalledTimes(2);
      expect(apiMocks.deleteClosetItem).toHaveBeenCalledTimes(2);
      expect(apiMocks.createPresignedImageUpload).toHaveBeenCalledTimes(4);
      expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenCalledTimes(4);
    });
  });
});
