#!/usr/bin/env node
// Run the ensure-search-extensions.sql bootstrap against $DATABASE_URL.
// Used by `pnpm --filter @workspace/db push` so trigram/unaccent indexes
// declared in the Drizzle schema can be created on a fresh database.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "ensure-search-extensions.sql"), "utf8");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to bootstrap search extensions");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log("[db] search extensions + f_unaccent() ready");
} catch (err) {
  console.error("[db] failed to ensure search extensions:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
