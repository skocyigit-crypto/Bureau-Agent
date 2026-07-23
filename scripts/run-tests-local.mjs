import { spawnSync } from "node:child_process";
import crypto from "node:crypto";

const project = "agent-bureau-test";
const container = "agent-bureau-test-db";
const password = crypto.randomBytes(24).toString("hex");
const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:55432/agent_de_bureau_test`;
process.env.TEST_POSTGRES_PASSWORD = password;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function docker(...args) {
  run("docker", ["compose", "--project-name", project, ...args]);
}

function cleanup() {
  try {
    docker("-f", "deploy/docker-compose.test.yml", "down", "--volumes", "--remove-orphans");
  } catch (error) {
    console.warn("[test:local] Test container cleanup failed:", error.message);
  }
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  docker(
    "-f", "deploy/docker-compose.test.yml",
    "up", "-d", "--wait",
    "--remove-orphans",
  );

  const env = {
    ...process.env,
    TEST_POSTGRES_PASSWORD: password,
    DATABASE_URL: databaseUrl,
    AI_INTEGRATIONS_GEMINI_BASE_URL: "http://127.0.0.1:9/unused",
    AI_INTEGRATIONS_GEMINI_API_KEY: "local-test-placeholder",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:9/unused",
    AI_INTEGRATIONS_OPENAI_API_KEY: "local-test-placeholder",
  };

  run("pnpm", [
    "--dir", "lib/db", "exec", "node", "./scripts/ensure-search-extensions.mjs",
  ], { env });
  run("pnpm", [
    "--dir", "lib/db", "exec", "node", "./scripts/ensure-unique-constraint-names.mjs",
  ], { env });
  run("pnpm", [
    "--dir", "lib/db", "exec", "node", "./scripts/ensure-automation-logs-rule-id.mjs",
  ], { env });
  run("pnpm", [
    "--dir", "lib/db", "exec", "node", "./scripts/ensure-fk-orphans.mjs",
  ], { env });
  run("pnpm", [
    "--dir", "lib/db", "exec", "drizzle-kit", "push", "--force",
    "--config", "./drizzle.config.ts",
  ], { env });
  run("pnpm", [
    "--dir", "lib/db", "exec", "node", "./scripts/ensure-audit-append-only.mjs",
  ], { env });

  run("pnpm", ["test"], { env });
} finally {
  cleanup();
}
