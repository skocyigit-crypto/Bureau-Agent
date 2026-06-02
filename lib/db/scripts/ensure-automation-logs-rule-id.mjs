#!/usr/bin/env node
// Apply ensure-automation-logs-rule-id.sql against $DATABASE_URL.
// Clears orphaned automation_logs.rule_id sentinels (historically 0) so the
// foreign key on automation_logs.rule_id can be created by `drizzle-kit push`.
// Idempotent — safe to call on every push.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "ensure-automation-logs-rule-id.sql"), "utf8");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to remediate automation_logs rule_id");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log("[db] automation_logs orphaned rule_id sentinels cleared");
} catch (err) {
  console.error("[db] failed to remediate automation_logs rule_id:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
