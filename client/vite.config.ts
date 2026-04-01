import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    testTimeout: 15_000,
    hookTimeout: 15_000
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true
  }
});
