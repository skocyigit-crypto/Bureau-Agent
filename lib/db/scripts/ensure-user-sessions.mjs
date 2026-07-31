#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to install the session table");
  process.exit(1);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(readFileSync(join(here, "ensure-user-sessions.sql"), "utf8"));
  console.log("[db] user_sessions table ready");
} catch (err) {
  console.error("[db] failed to ensure user_sessions:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}