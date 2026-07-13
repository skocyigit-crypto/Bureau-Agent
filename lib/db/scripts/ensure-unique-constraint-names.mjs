#!/usr/bin/env node
// Apply ensure-unique-constraint-names.sql against $DATABASE_URL.
// Renames legacy `<table>_<col>_key` unique constraints to Drizzle's expected
// `<table>_<col>_unique` names so `drizzle-kit push` does not prompt to truncate
// populated tables when adding unique constraints.
// Idempotent — safe to call on every push.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "ensure-unique-constraint-names.sql"), "utf8");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to reconcile unique constraint names");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log("[db] legacy *_key unique constraints reconciled to *_unique");
} catch (err) {
  console.error("[db] failed to reconcile unique constraint names:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
