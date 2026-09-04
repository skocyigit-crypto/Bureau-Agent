#!/usr/bin/env node
// Post-push verification: assert the schema sync produced the objects the app
// depends on and did NOT destroy the externally-owned session table.
//
// Runs at the end of `push` / `push-force` (and standalone via `pnpm verify`).
// Exits non-zero on any failed assertion so a drifted/broken sync is caught in
// CI / post-merge instead of surfacing later as a runtime 500.

import pg from "pg";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to verify schema sync");
  process.exit(1);
}

// Tables that must exist for core features to work. agent_proposals backs
// GET /api/agent-queue/count (a missing table returned HTTP 500); bulk_scan_jobs
// backs the document bulk-scan flow.
// platform_invoice_sequences porte la numerotation continue des factures que
// la plateforme emet a ses clients: sans elle, aucune facture ne peut etre
// emise (art. 242 nonies A de l'annexe II au CGI).
const REQUIRED_TABLES = [
  "agent_proposals",
  "bulk_scan_jobs",
  "whatsapp_processed_messages",
  "platform_invoice_sequences",
];

// Columns added to existing tables by the same schema revision.
const REQUIRED_COLUMNS = [
  ["documents", "scan_verdict"],
  ["organisations", "reused_scan_count"],
  ["organisations", "ai_learning_last_run_at"],
  ["calendar_events", "google_event_id"],
  // Sans ces colonnes, toute lecture de facture leve une erreur SQL: le code
  // les selectionne nommement. C'est le cas typique ou le deploiement passe et
  // ou la panne n'apparait qu'a la premiere consultation d'une facture.
  ["invoices", "reference"],
  ["invoices", "vat_amount"],
  ["invoices", "total_ttc"],
  ["invoices", "buyer_snapshot"],
];

const client = new Client({ connectionString: process.env.DATABASE_URL });
const failures = [];

async function tableExists(name) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [name],
  );
  return rows.length > 0;
}

async function columnExists(table, column) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
    [table, column],
  );
  return rows.length > 0;
}

try {
  await client.connect();

  for (const t of REQUIRED_TABLES) {
    if (!(await tableExists(t))) failures.push(`missing required table: ${t}`);
  }

  for (const [t, c] of REQUIRED_COLUMNS) {
    if (await tableExists(t)) {
      if (!(await columnExists(t, c))) failures.push(`missing column: ${t}.${c}`);
    } else {
      failures.push(`missing required table (for column check): ${t}`);
    }
  }

  // user_sessions is owned by connect-pg-simple and excluded from the Drizzle
  // schema. A correct push must leave it intact — never drop/rename it.
  if (!(await tableExists("user_sessions"))) {
    failures.push("user_sessions table is missing — session store was destroyed");
  }

  if (failures.length > 0) {
    console.error("[db] schema sync verification FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("[db] schema sync verified — required tables/columns present, user_sessions intact");
} catch (err) {
  console.error("[db] schema sync verification error:", err?.message || err);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
