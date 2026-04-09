/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WardrobePage } from "./wardrobe-page";
import type { ClothingItem, ClosetItemRecord } from "../types";

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

const UI_TIMEOUT_MS = 5_000;

function createJsonFetchResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload
  } as Response;
}

function createBlobFetchResponse(data: string, type: string): Response {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([data], { type })
  } as Response;
}

function toClosetItemRecord(item: {
  id: string;
  imageUrl: string;
  analysisStatus: "pending" | "ready" | "error";
  analysisError: string | null;
  name: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
}): ClosetItemRecord {
  return {
    id: item.id,
    userId: "user-1",
    imageUrl: item.imageUrl,
    analysisStatus: item.analysisStatus,
    analysisError: item.analysisError,
    name: item.name,
    category: item.category,
    tags: item.tags,
    description: item.description,
    createdAt: item.createdAt ?? "2026-03-25T10:00:00.000Z",
    updatedAt: item.updatedAt ?? item.createdAt ?? "2026-03-25T10:00:00.000Z"
  };
}

async function waitForImportedWardrobe(expectedImportCalls: number, expectedUploadCalls: number): Promise<void> {
  await waitFor(() => {
    expect(apiMocks.importTestClosetItems).toHaveBeenCalledTimes(expectedImportCalls);
    expect(apiMocks.createPresignedImageUpload).toHaveBeenCalledTimes(expectedUploadCalls);
    expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenCalledTimes(expectedUploadCalls);
  }, { timeout: UI_TIMEOUT_MS });

  expect(await screen.findByText(/alpha top/i, {}, { timeout: UI_TIMEOUT_MS })).toBeInTheDocument();
  expect(await screen.findByText(/beta pants/i, {}, { timeout: UI_TIMEOUT_MS })).toBeInTheDocument();
  expect(
    await screen.findByText(/2 test item\(s\) imported into your wardrobe\./i, {}, { timeout: UI_TIMEOUT_MS })
  ).toBeInTheDocument();

  await waitFor(() => {
    expect(screen.getAllByLabelText("Delete item")).toHaveLength(2);
  }, { timeout: UI_TIMEOUT_MS });
}

async function deleteAllImportedItems(user: ReturnType<typeof userEvent.setup>, expectedDeleteCalls: number): Promise<void> {
  for (let call = 1; call <= expectedDeleteCalls; call += 1) {
    const [deleteButton] = await screen.findAllByLabelText("Delete item", {}, { timeout: UI_TIMEOUT_MS });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(apiMocks.deleteClosetItem).toHaveBeenCalledTimes(call);
    }, { timeout: UI_TIMEOUT_MS });
  }
}

describe("WardrobePage Add test data regression", () => {
  let wardrobeState: ClothingItem[];
  let importedRecordCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    wardrobeState = [];
    importedRecordCounter = 0;

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
      const existingImageUrls = new Set(wardrobeState.map((item) => item.imageUrl));
      const importedRecords: ClosetItemRecord[] = [];

      payload.items.forEach((item, index) => {
        if (existingImageUrls.has(item.imageUrl)) {
          return;
        }

        importedRecordCounter += 1;
        existingImageUrls.add(item.imageUrl);
        importedRecords.push(
          toClosetItemRecord({
            id: `imported-item-${importedRecordCounter}`,
            imageUrl: item.imageUrl,
            analysisStatus: item.analysisStatus,
            analysisError: item.analysisError,
            name: item.name,
            category: item.category,
            tags: item.tags,
            description: item.description,
            createdAt: item.createdAt ?? `2026-03-25T10:00:0${index}.000Z`,
            updatedAt: item.createdAt ?? `2026-03-25T10:00:0${index}.000Z`
          })
        );
      });

      wardrobeState = [
        ...wardrobeState,
        ...importedRecords.map((item) => ({
          id: item.id,
          title: item.name ?? "Processing...",
          category: (item.category ?? "tops") as ClothingItem["category"],
          tags: item.tags,
          description: item.description ?? "",
          imageUrl: item.imageUrl,
          status: item.analysisStatus === "ready" ? "finished" : "unfinished",
          createdAt: item.createdAt
        }))
      ];

      return importedRecords;
    });

    apiMocks.deleteClosetItem.mockImplementation(async (_token, itemId: string) => {
      wardrobeState = wardrobeState.filter((item) => item.id !== itemId);
    });

    apiMocks.createPresignedImageUpload.mockImplementation(async (_token, payload: { fileName: string }) => ({
      uploadUrl: `https://upload.test/${payload.fileName}`,
      publicUrl: `https://public.test/user-1/closet/${payload.fileName}`,
      key: `user-1/closet/${payload.fileName}`
    }));

    apiMocks.uploadFileToPresignedUrl.mockResolvedValue(undefined);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/sample-data/sample-clothes-data.json") {
        return createJsonFetchResponse(sampleItems);
      }

      if (url === "/sample-data/images/alpha-top.png") {
        return createBlobFetchResponse("alpha", "image/png");
      }

      if (url === "/sample-data/images/beta-pants.jpg") {
        return createBlobFetchResponse("beta", "image/jpeg");
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

    await waitForImportedWardrobe(1, 2);

    await deleteAllImportedItems(user, 2);

    await screen.findByText("No items found for this filter.", {}, { timeout: UI_TIMEOUT_MS });

    await user.click(screen.getByRole("button", { name: "Add test data" }));

    await waitForImportedWardrobe(2, 4);

    await waitFor(() => {
      expect(apiMocks.importTestClosetItems).toHaveBeenCalledTimes(2);
      expect(apiMocks.deleteClosetItem).toHaveBeenCalledTimes(2);
      expect(apiMocks.createPresignedImageUpload).toHaveBeenCalledTimes(4);
      expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenCalledTimes(4);
    });
  });

  it("does not show duplicate wardrobe items when test data is imported twice", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <WardrobePage />
      </MemoryRouter>
    );

    await screen.findByText("No items found for this filter.");

    await user.click(screen.getByRole("button", { name: "Add test data" }));
    await waitForImportedWardrobe(1, 2);

    await user.click(screen.getByRole("button", { name: "Add test data" }));

    await waitFor(() => {
      expect(apiMocks.importTestClosetItems).toHaveBeenCalledTimes(1);
      expect(apiMocks.createPresignedImageUpload).toHaveBeenCalledTimes(2);
      expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenCalledTimes(2);
      expect(screen.getAllByLabelText("Delete item")).toHaveLength(2);
    }, { timeout: UI_TIMEOUT_MS });

    expect(await screen.findByText("Test data is already in your wardrobe.")).toBeInTheDocument();
  });

  it("only uploads and imports the missing sample items on a later import", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <WardrobePage />
      </MemoryRouter>
    );

    await screen.findByText("No items found for this filter.");

    await user.click(screen.getByRole("button", { name: "Add test data" }));
    await waitForImportedWardrobe(1, 2);

    const [deleteButton] = await screen.findAllByLabelText("Delete item", {}, { timeout: UI_TIMEOUT_MS });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(apiMocks.deleteClosetItem).toHaveBeenCalledTimes(1);
      expect(screen.getAllByLabelText("Delete item")).toHaveLength(1);
    }, { timeout: UI_TIMEOUT_MS });

    await user.click(screen.getByRole("button", { name: "Add test data" }));

    await waitFor(() => {
      expect(apiMocks.importTestClosetItems).toHaveBeenCalledTimes(2);
      expect(apiMocks.createPresignedImageUpload).toHaveBeenCalledTimes(3);
      expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenCalledTimes(3);
      expect(screen.getAllByLabelText("Delete item")).toHaveLength(2);
    }, { timeout: UI_TIMEOUT_MS });

    expect(apiMocks.importTestClosetItems.mock.calls[1][1].items).toHaveLength(1);
    expect(
      await screen.findByText(/1 test item\(s\) imported into your wardrobe\./i, {}, { timeout: UI_TIMEOUT_MS })
    ).toBeInTheDocument();
  });
});
