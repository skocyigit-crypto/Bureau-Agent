#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const statement = readFileSync(join(here, "ensure-user-quota.sql"), "utf8");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to install the user quota trigger");
  process.exit(1);
}
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query(statement);
  console.log("[db] atomic organisation user-quota trigger installed");
} catch (err) {
  console.error("[db] failed to install user-quota trigger:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}