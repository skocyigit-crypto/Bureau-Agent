#!/usr/bin/env node
// Apply ensure-audit-append-only.sql against $DATABASE_URL.
// Installs Postgres triggers that block UPDATE/DELETE on the audit tables.
// Idempotent — safe to call on every push and on every api-server boot.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "ensure-audit-append-only.sql"), "utf8");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to install audit append-only triggers");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(sql);
  console.log("[db] audit_logs + license_audit_log append-only triggers installed");
} catch (err) {
  console.error("[db] failed to install audit append-only triggers:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
