import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddPage } from "./add-page";

const apiMocks = vi.hoisted(() => ({
  createClosetItem: vi.fn(),
  uploadFileToPresignedUrl: vi.fn(),
  analyzeClosetItem: vi.fn()
}));

vi.mock("../context/auth-context", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { id: "u1", name: "Alice", email: "alice@example.com", picture: null },
    profile: null
  })
}));

vi.mock("../lib/api", () => apiMocks);

function renderAddPage() {
  return render(
    <MemoryRouter>
      <AddPage />
    </MemoryRouter>
  );
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected file input to be rendered.");
  }

  return input;
}

function createTestFile(name: string, type: string, contents = "test-image"): File {
  return new File([contents], name, { type });
}

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("AddPage", () => {
  let createObjectUrlMock: ReturnType<typeof vi.fn>;
  let revokeObjectUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    createObjectUrlMock = vi.fn(() => "blob:mock");
    revokeObjectUrlMock = vi.fn();

    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlMock
    });

    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock
    });

    apiMocks.createClosetItem.mockResolvedValue({
      item: { id: "item-1" },
      uploadUrl: "https://upload.test/item-1"
    });
    apiMocks.uploadFileToPresignedUrl.mockResolvedValue(undefined);
    apiMocks.analyzeClosetItem.mockResolvedValue(undefined);
  });

  it("renders the upload area and Choose Files button", () => {
    renderAddPage();

    expect(screen.getByText(/drag and drop your clothing photos here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /choose files/i })).toBeInTheDocument();
  });

  it("disables the Upload button before any file is selected", () => {
    renderAddPage();

    expect(screen.getByRole("button", { name: /^upload$/i })).toBeDisabled();
  });

  it("shows the selected filename after a file is chosen", async () => {
    const user = userEvent.setup();
    const { container } = renderAddPage();
    const fileInput = getFileInput(container);
    const file = createTestFile("blue-shirt.png", "image/png");

    await user.upload(fileInput, file);

    expect(screen.getByText("blue-shirt.png")).toBeInTheDocument();
    expect(createObjectUrlMock).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: /^upload$/i })).not.toBeDisabled();
  });

  it("uploads selected files by calling createClosetItem, uploadFileToPresignedUrl, and analyzeClosetItem in order", async () => {
    const user = userEvent.setup();
    const { container } = renderAddPage();
    const fileInput = getFileInput(container);
    const firstFile = createTestFile("blue-shirt.png", "image/png");
    const secondFile = createTestFile("black-pants.jpg", "image/jpeg");
    const callOrder: string[] = [];
    let itemCounter = 0;

    apiMocks.createClosetItem.mockImplementation(async (_token: string, contentType: string) => {
      itemCounter += 1;
      callOrder.push(`create:${contentType}`);

      return {
        item: { id: `item-${itemCounter}` },
        uploadUrl: `https://upload.test/item-${itemCounter}`
      };
    });

    apiMocks.uploadFileToPresignedUrl.mockImplementation(async (uploadUrl: string, file: File) => {
      callOrder.push(`upload:${uploadUrl}:${file.name}`);
    });

    apiMocks.analyzeClosetItem.mockImplementation(async (_token: string, itemId: string, mimeType: string) => {
      callOrder.push(`analyze:${itemId}:${mimeType}`);
    });

    await user.upload(fileInput, [firstFile, secondFile]);
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await waitFor(() => {
      expect(apiMocks.createClosetItem).toHaveBeenCalledTimes(2);
      expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenCalledTimes(2);
      expect(apiMocks.analyzeClosetItem).toHaveBeenCalledTimes(2);
    });

    expect(apiMocks.createClosetItem).toHaveBeenNthCalledWith(1, "test-token", "image/png");
    expect(apiMocks.createClosetItem).toHaveBeenNthCalledWith(2, "test-token", "image/jpeg");
    expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenNthCalledWith(1, "https://upload.test/item-1", firstFile);
    expect(apiMocks.uploadFileToPresignedUrl).toHaveBeenNthCalledWith(2, "https://upload.test/item-2", secondFile);
    expect(apiMocks.analyzeClosetItem).toHaveBeenNthCalledWith(1, "test-token", "item-1", "image/png");
    expect(apiMocks.analyzeClosetItem).toHaveBeenNthCalledWith(2, "test-token", "item-2", "image/jpeg");
    expect(callOrder).toEqual([
      "create:image/png",
      "upload:https://upload.test/item-1:blue-shirt.png",
      "analyze:item-1:image/png",
      "create:image/jpeg",
      "upload:https://upload.test/item-2:black-pants.jpg",
      "analyze:item-2:image/jpeg"
    ]);

    await screen.findByText("2 item(s) uploaded and analyzed successfully.");
  });

  it("shows upload progress while the upload is in flight", async () => {
    const user = userEvent.setup();
    const { container } = renderAddPage();
    const fileInput = getFileInput(container);
    const file = createTestFile("coat.webp", "image/webp");
    const uploadGate = createDeferredPromise<void>();

    apiMocks.uploadFileToPresignedUrl.mockReturnValue(uploadGate.promise);

    await user.upload(fileInput, file);
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /uploading 1 of 1/i })).toBeDisabled();
    });

    uploadGate.resolve(undefined);

    await waitFor(() => {
      expect(apiMocks.analyzeClosetItem).toHaveBeenCalledOnce();
    });
  });

  it("shows success feedback when upload completes", async () => {
    const user = userEvent.setup();
    const { container } = renderAddPage();
    const fileInput = getFileInput(container);
    const file = createTestFile("dress.png", "image/png");

    await user.upload(fileInput, file);
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    expect(await screen.findByText("1 item(s) uploaded and analyzed successfully.")).toBeInTheDocument();
  });

  it("shows an error message when upload fails", async () => {
    const user = userEvent.setup();
    const { container } = renderAddPage();
    const fileInput = getFileInput(container);
    const file = createTestFile("boots.png", "image/png");

    apiMocks.uploadFileToPresignedUrl.mockRejectedValue(new Error("Presigned upload failed."));

    await user.upload(fileInput, file);
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    expect(await screen.findByText("Upload failed after 0 item(s): Presigned upload failed.")).toBeInTheDocument();
    expect(apiMocks.analyzeClosetItem).not.toHaveBeenCalled();
  });
});
