import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Use Node's Blob/File implementations to avoid CI-only incompatibilities
// between jsdom objects and undici-based Response handling.
Object.defineProperty(globalThis, "Blob", {
  configurable: true,
  writable: true,
  value: NodeBlob
});

Object.defineProperty(globalThis, "File", {
  configurable: true,
  writable: true,
  value: NodeFile
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
