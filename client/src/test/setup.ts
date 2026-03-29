import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
