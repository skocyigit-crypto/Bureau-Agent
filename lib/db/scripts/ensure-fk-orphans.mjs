#!/usr/bin/env node
// Apply ensure-fk-orphans.sql against $DATABASE_URL.
// Cleans orphaned child rows (per the schema's onDelete semantics) so
// `drizzle-kit push` can add foreign keys on a drifted database without hitting
// Postgres error 23503 ("violates foreign key constraint").
// Idempotent — safe to call on every push.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "ensure-fk-orphans.sql"), "utf8");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to remediate foreign key orphans");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log("[db] foreign key orphan rows remediated (audit_logs, notifications)");
} catch (err) {
  console.error("[db] failed to remediate foreign key orphans:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
