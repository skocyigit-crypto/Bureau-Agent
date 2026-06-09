import { defineConfig } from "vitest/config";

// Pure-logic codec tests run in node — btoa/atob/escape/unescape are global in
// Node 24, and the storage/clock are injected so no DOM is needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
