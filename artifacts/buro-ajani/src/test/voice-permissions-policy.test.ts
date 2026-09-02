import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");

describe("VoiceLive Permissions-Policy", () => {
  it.each([
    "artifacts/buro-ajani/vite.config.ts",
    "artifacts/api-server/src/app.ts",
    "deploy/non-docker/nginx.conf",
  ])("allows first-party microphone capture in %s", (relativePath) => {
    const source = readFileSync(resolve(workspaceRoot, relativePath), "utf8");

    expect(source).toContain("microphone=(self)");
    expect(source).not.toMatch(/microphone=\(\)(?:[\"',;]|\s+always)/);
  });
});
