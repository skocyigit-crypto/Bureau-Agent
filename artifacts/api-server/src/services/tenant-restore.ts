/**
 * Restauration a partir d'une sauvegarde du client.
 *
 * Une sauvegarde qu'on ne sait pas remettre en place n'est qu'un fichier. Le
 * client pouvait telecharger la sienne mais n'avait aucun moyen de recuperer
 * ce qu'il avait supprime par erreur — c'est pourtant le cas qui motive tout
 * le reste.
 *
 * REGLE ABSOLUE: la restauration n'AJOUTE que ce qui manque. Elle ne met a
 * jour aucune ligne existante et n'en supprime aucune. Un client qui restaure
 * une sauvegarde d'hier ne perd donc rien de ce qu'il a fait aujourd'hui — ce
 * qui serait le pire resultat possible pour une fonction censee proteger ses
 * donnees.
 *
 * Le contenu vient d'une sauvegarde STOCKEE par le serveur (verifiee par son
 * empreinte), jamais d'un fichier televerse: il n'existe pas de chemin par
 * lequel un appelant injecterait des lignes arbitraires.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import type { BackupContent } from "./tenant-backup";

/**
 * Tables restaurables, PARENTS D'ABORD: une facture reference son devis, un
 * message sa conversation. Une ligne dont le parent manque encore echoue seule
 * et est comptee, elle n'interrompt pas la restauration.
 *
 * Volontairement absentes: les tables d'authentification et de facturation de
 * la plateforme (`users`, `api_keys`, `subscriptions` — reinjecter un compte ou
 * un abonnement supprime serait une faille, pas un service), les journaux
 * (`audit_logs`, `license_audit_log`, append-only par declencheur), et la
 * telemetrie (`ai_usage`, `webhook_deliveries`) qui ne represente pas le
 * travail du client.
 */
export const RESTORABLE_TABLES = [
  "contacts",
  "prospects",
  "devis",
  "factures_client",
  "invoices",
  "payments",
  "compte_client",
  "projets",
  "tasks",
  "calendar_events",
  "calls",
  "messages",
  "notes_internes",
  "documents",
  "depenses",
  "stock_articles",
  "stock_mouvements",
  "commandes_fournisseur",
  "objectifs_commerciaux",
  "checkins",
  "geofences",
  "organisation_closures",
  "treasury_settings",
  "whatsapp_conversations",
  "whatsapp_messages",
] as const;

export interface RestorePlanEntry {
  table: string;
  inBackup: number;
  missing: number;
}

export interface RestoreResult {
  restored: number;
  skipped: number;
  failed: number;
  perTable: Array<{ table: string; restored: number; failed: number }>;
}

function rowsOf(content: BackupContent, table: string): Array<Record<string, unknown>> {
  const rows = content.tables[table];
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

/** Identifiants deja presents en base pour cette table et cette organisation. */
async function existingIds(table: string, orgId: number): Promise<Set<number>> {
  const res = await withDbRetry(
    () => db.execute(sql`SELECT id FROM ${sql.identifier(table)} WHERE organisation_id = ${orgId}`),
    { label: `tenant-restore:ids-${table}` },
  );
  const rows: Array<{ id: number }> = Array.isArray(res) ? (res as any) : ((res as any)?.rows ?? []);
  return new Set(rows.map((r) => Number(r.id)));
}

/**
 * Ce qu'une restauration ajouterait, sans rien ecrire. Le client doit pouvoir
 * lire cette liste avant de decider.
 */
export async function planRestore(content: BackupContent, orgId: number): Promise<RestorePlanEntry[]> {
  const plan: RestorePlanEntry[] = [];
  for (const table of RESTORABLE_TABLES) {
    const rows = rowsOf(content, table);
    if (rows.length === 0) continue;
    const present = await existingIds(table, orgId);
    const missing = rows.filter((r) => !present.has(Number(r.id))).length;
    if (missing > 0) plan.push({ table, inBackup: rows.length, missing });
  }
  return plan;
}

/**
 * Reinsere les lignes absentes. Chaque ligne est reecrite avec
 * `organisation_id = orgId`: meme si un contenu venait d'ailleurs, il ne
 * pourrait pas atterrir dans une autre organisation.
 */
export async function restoreMissingRows(
  content: BackupContent,
  orgId: number,
  opts: { tables?: string[] } = {},
): Promise<RestoreResult> {
  const allowed = new Set<string>(RESTORABLE_TABLES);
  const targets = (opts.tables?.length ? opts.tables : [...RESTORABLE_TABLES]).filter((t) => allowed.has(t));

  const result: RestoreResult = { restored: 0, skipped: 0, failed: 0, perTable: [] };

  for (const table of targets) {
    const rows = rowsOf(content, table);
    if (rows.length === 0) continue;
    const present = await existingIds(table, orgId);
    const missing = rows.filter((r) => !present.has(Number(r.id)));
    result.skipped += rows.length - missing.length;
    if (missing.length === 0) continue;

    let restored = 0, failed = 0;
    for (const row of missing) {
      const payload: Record<string, unknown> = { ...row, organisation_id: orgId };
      const columns = Object.keys(payload);
      const identifiers = sql.join(columns.map((c) => sql.identifier(c)), sql`, `);
      const values = sql.join(columns.map((c) => sql`${payload[c] as never}`), sql`, `);
      try {
        // ON CONFLICT DO NOTHING: une course avec une autre restauration ou une
        // creation manuelle ne doit pas faire echouer la ligne.
        await db.execute(sql`
          INSERT INTO ${sql.identifier(table)} (${identifiers})
          VALUES (${values})
          ON CONFLICT DO NOTHING
        `);
        restored++;
      } catch (err) {
        // Cause typique: un parent lui-meme supprime (contact d'une facture).
        // La ligne est comptee et la restauration continue.
        failed++;
        logger.warn({ err, table, orgId, id: row.id }, "[tenant-restore] ligne non restauree");
      }
    }

    result.restored += restored;
    result.failed += failed;
    result.perTable.push({ table, restored, failed });
  }

  // Les sequences suivent les identifiants reinseres, sinon la prochaine
  // creation entrerait en collision avec une ligne restauree.
  for (const { table } of result.perTable) {
    await db.execute(sql`
      SELECT setval(
        pg_get_serial_sequence(${table}, 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${sql.identifier(table)}), 1)
      )
    `).catch(() => { /* table sans sequence: rien a recaler */ });
  }

  logger.info({ orgId, ...result, perTable: undefined }, "[tenant-restore] restauration terminee");
  return result;
}
