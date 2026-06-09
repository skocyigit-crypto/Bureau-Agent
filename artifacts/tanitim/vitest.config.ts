import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Deterministic logic tests for the marketing site. We keep them in node (no
// DOM) and resolve the "@/" alias the same way Vite/tsconfig do.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Match the app's automatic JSX runtime so component source need not import
  // React explicitly (Vite's react plugin does this in dev/build).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
