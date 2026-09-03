/**
 * Sauvegarde des donnees d'UNE organisation, telechargeable par le client.
 *
 * Ce qui existait avant, et pourquoi cela ne suffisait pas:
 *   - `auto-backup.ts` n'exporte aucune donnee: il COMPTE des lignes, hache le
 *     resume et enregistre une ligne. Rien a restaurer.
 *   - `google-drive-backup.ts` exporte de vraies donnees, mais avec des
 *     `SELECT * FROM table` sans filtre: le contenu de TOUS les clients. Le
 *     brancher sur le Drive d'un client aurait livre les donnees des autres.
 *     Son planificateur n'a jamais ete demarre.
 *   - L'ecran « Sauvegardes » du client appelait `/api/workspace/backups*`,
 *     des routes qui n'existent pas.
 *   - Cloud SQL sauvegarde l'instance (7 jours, PITR). Cela protege la base,
 *     pas le client: une suppression accidentelle reste perdue pour lui, et il
 *     ne peut rien recuperer sans passer par nous.
 *
 * Ici: toutes les lignes portant `organisation_id = <org>`, plus la fiche de
 * l'organisation, en JSON gzip. Les colonnes de secrets sont retirees — un
 * export telecharge puis egare ne doit pas livrer de jetons d'integration ni
 * d'empreintes de mots de passe.
 */
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db, organisationBackupsTable, organisationsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";

/**
 * Toutes les tables portant `organisation_id`. Cette liste EST le perimetre de
 * la sauvegarde: une table absente est une donnee que le client ne recupere
 * pas. `tenant-backup-coverage.test.ts` la compare au schema et echoue des
 * qu'une table tenant est ajoutee sans etre couverte ici.
 */
export const TENANT_TABLES = [
  "admin_reports", "agent_proposals", "ai_agent_reports", "ai_inline_suggest_events",
  "ai_insights", "ai_learned_preferences", "ai_recurring_patterns", "ai_user_profile_facts",
  "ai_providers", "ai_usage", "api_keys", "app_audit_findings", "appointment_offers",
  "assistant_conversations", "assistant_messages", "audit_logs", "automation_rules",
  "notifications", "bulk_scan_jobs", "calendar_events", "calls", "checkins",
  "commandant_conversations", "commandant_messages", "commandes_fournisseur",
  "compte_client", "contacts", "daily_reports", "data_subject_requests",
  // La corbeille contient des lignes que le client a supprimees mais dont il
  // dispose encore: elles sont a lui tant que le delai de retention court.
  "deleted_rows",
  "demo_handoffs", "depenses", "devis", "documents", "email_providers",
  "face_profiles", "face_recognition_logs", "factures_client", "google_oauth_tokens",
  "google_app_credentials", "integration_connections", "invitations", "invoices",
  "payments", "document_chunks", "legal_agreements", "geofences",
  "user_location_state", "location_events", "messages", "notes_internes",
  "objectifs_commerciaux", "organisation_closures", "payment_reminders",
  "license_audit_log", "performance_reports", "platform_connections",
  "platform_sync_logs", "proactive_suggestions", "projets", "prospects",
  "push_tokens", "security_lists", "security_scans", "stock_mouvements",
  "stock_articles", "subscriptions", "tasks", "telephony_providers",
  "telephony_call_logs", "telephony_sms_logs", "treasury_settings", "users",
  "webhook_deliveries", "webhook_endpoints", "whatsapp_processed_messages",
  "whatsapp_conversations", "whatsapp_messages",
] as const;

/**
 * Tables volontairement HORS sauvegarde client, avec leur raison. La table de
 * sauvegardes elle-meme en fait partie: s'inclure produirait une croissance
 * exponentielle a chaque prise.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  organisation_backups: "les sauvegardes elles-memes (croissance exponentielle)",
};

/**
 * Colonnes retirees de l'export, par nom. Elles portent des secrets vivants
 * (jetons, cles, empreintes) dont la fuite compromettrait le compte du client
 * ou ses integrations. Leur presence est remplacee par null, ce qui garde la
 * forme de la ligne — un import ulterieur voit qu'il faut re-saisir le secret.
 */
export const REDACTED_COLUMNS = new Set([
  "password_hash",
  "mfa_secret",
  "key_hash",
  "access_token",
  "refresh_token",
  "client_secret_enc",
  "secret",
  "secrets",
]);

/** Au-dela, on refuse de stocker: la ligne deviendrait ingerable en base. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

/** Nombre de sauvegardes conservees par organisation. */
export const DEFAULT_RETENTION = 14;

/** Lignes lues par lot: borne la memoire sur les tables volumineuses. */
const BATCH_SIZE = 2000;

export interface BackupContent {
  meta: {
    organisationId: number;
    organisationName: string | null;
    exportedAt: string;
    format: "ajant-bureau/organisation-backup";
    /**
     * Tables declarees que la base ne connaissait pas au moment de la
     * sauvegarde. Vide dans le cas normal; non vide, c'est le signe que le
     * schema de production est en retard sur le code deploye.
     */
    unavailableTables?: string[];
    version: 1;
    tables: number;
    rows: number;
    redactedColumns: string[];
    excludedTables: Record<string, string>;
  };
  tables: Record<string, unknown[]>;
}

/** Retire les colonnes de secrets d'une ligne, en conservant sa forme. */
export function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = REDACTED_COLUMNS.has(key) ? null : value;
  }
  return out;
}

/**
 * Postgres 42P01 « undefined_table ».
 *
 * Le CODE est teste, pas le message: celui-ci est traduit selon la locale
 * du serveur, et un test sur son texte casserait en silence le jour ou la
 * base parle une autre langue.
 */
function isUndefinedTable(err: unknown): boolean {
  const cause = (err as { cause?: unknown })?.cause;
  for (const candidate of [err, cause]) {
    if (candidate && typeof candidate === "object" && (candidate as { code?: string }).code === "42P01") {
      return true;
    }
  }
  return false;
}

/**
 * Construit le contenu de la sauvegarde d'une organisation. Lecture par lots,
 * chaque table bornee a `organisation_id`.
 */
export async function buildOrganisationBackup(
  orgId: number,
  /**
   * Tables a parcourir. Injectable UNIQUEMENT pour rendre verifiable le
   * comportement face a une table absente: autrement, la seule facon de
   * l'eprouver serait d'en supprimer une vraie.
   */
  tableNames: readonly string[] = TENANT_TABLES,
): Promise<BackupContent> {
  const [org] = await withDbRetry(
    () => db.select({ id: organisationsTable.id, name: organisationsTable.name })
      .from(organisationsTable).where(eq(organisationsTable.id, orgId)),
    { label: "tenant-backup:org" },
  );

  const tables: Record<string, unknown[]> = {};
  let rows = 0;

  /**
   * Tables declarees mais absentes de la base au moment de la sauvegarde.
   *
   * Le schema de production n'est PAS pousse par le pipeline de deploiement:
   * la porte de qualite synchronise la base de CI, et la production se met a
   * jour par un `gcp-schema-push.sh` lance a part. Il existe donc une fenetre,
   * a chaque nouvelle table, ou le code deploye connait une table que la base
   * ne connait pas encore.
   *
   * Sans le rattrapage ci-dessous, cette fenetre ne degradait pas la
   * sauvegarde: elle la SUPPRIMAIT. La boucle n'attrapait rien, donc une seule
   * table manquante faisait echouer la sauvegarde entiere de chaque client,
   * pour une raison sans rapport avec leurs donnees.
   *
   * On continue donc, mais jamais en silence: la table absente est nommee dans
   * le fichier produit et journalisee en erreur. Une sauvegarde incomplete
   * qu'on sait incomplete reste utile; une sauvegarde incomplete qui se croit
   * complete est un piege.
   */
  const unavailable: string[] = [];

  for (const table of tableNames) {
    const collected: unknown[] = [];
    let offset = 0;
    // Boucle par lots: une organisation avec 200 000 appels ne doit pas
    // materialiser la table entiere en une fois.
    let missing = false;
    for (;;) {
      let batch;
      try {
        batch = await withDbRetry(
          () => db.execute(sql`
            SELECT * FROM ${sql.identifier(table)}
            WHERE organisation_id = ${orgId}
            ORDER BY 1
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
          `),
          { label: `tenant-backup:${table}` },
        );
      } catch (err) {
        // 42P01 = undefined_table. On ne rattrape QUE ce cas: toute autre
        // erreur (droits, connexion, requete malformee) doit continuer de
        // faire echouer la sauvegarde, parce qu'elle ne se limiterait pas a
        // une table.
        if (!isUndefinedTable(err)) throw err;
        logger.error(
          { table, orgId },
          "[tenant-backup] table declaree absente de la base — sauvegarde incomplete",
        );
        unavailable.push(table);
        missing = true;
        break;
      }
      const batchRows: Record<string, unknown>[] = Array.isArray(batch)
        ? (batch as Record<string, unknown>[])
        : ((batch as { rows?: Record<string, unknown>[] })?.rows ?? []);
      for (const row of batchRows) collected.push(redactRow(row));
      if (batchRows.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }
    if (missing) continue;
    tables[table] = collected;
    rows += collected.length;
  }

  // La fiche de l'organisation elle-meme: elle n'a pas de colonne
  // organisation_id mais fait evidemment partie des donnees du client.
  const [orgRow] = await withDbRetry(
    () => db.execute(sql`SELECT * FROM organisations WHERE id = ${orgId}`).then((r: any) =>
      (Array.isArray(r) ? r : r?.rows ?? []) as Record<string, unknown>[]),
    { label: "tenant-backup:organisations" },
  );
  tables.organisations = orgRow ? [redactRow(orgRow)] : [];
  rows += tables.organisations.length;

  return {
    meta: {
      organisationId: orgId,
      organisationName: org?.name ?? null,
      exportedAt: new Date().toISOString(),
      format: "ajant-bureau/organisation-backup",
      unavailableTables: unavailable,
      version: 1,
      tables: Object.keys(tables).length,
      rows,
      redactedColumns: [...REDACTED_COLUMNS].sort(),
      excludedTables: EXCLUDED_TABLES,
    },
    tables,
  };
}

export interface StoredBackup {
  id: number;
  sizeBytes: number;
  rowCount: number;
  checksum: string;
}

/** Compte les lignes par table, pour l'affichage et la verification. */
export function tableCountsOf(content: BackupContent): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(content.tables)) {
    if (rows.length > 0) counts[table] = rows.length;
  }
  return counts;
}

/**
 * Prend une sauvegarde et la stocke, puis applique la retention.
 * `origin`: `auto` pour le cron quotidien, `manual` pour le bouton du client.
 */
export async function createOrganisationBackup(
  orgId: number,
  opts: { origin?: "auto" | "manual"; userId?: number | null; retention?: number } = {},
): Promise<StoredBackup> {
  const content = await buildOrganisationBackup(orgId);
  const json = JSON.stringify(content);
  const checksum = createHash("sha256").update(json).digest("hex");
  const gzipped = gzipSync(Buffer.from(json, "utf8"), { level: 9 });

  if (gzipped.length > MAX_BACKUP_BYTES) {
    throw new Error(
      `Sauvegarde trop volumineuse (${Math.round(gzipped.length / 1024 / 1024)} Mo compresses, plafond ${MAX_BACKUP_BYTES / 1024 / 1024} Mo).`,
    );
  }

  const [saved] = await withDbRetry(
    () => db.insert(organisationBackupsTable).values({
      organisationId: orgId,
      origin: opts.origin ?? "auto",
      createdBy: opts.userId ?? null,
      tableCounts: tableCountsOf(content),
      rowCount: content.meta.rows,
      sizeBytes: gzipped.length,
      checksum,
      content: gzipped,
    }).returning({ id: organisationBackupsTable.id }),
    { label: "tenant-backup:insert" },
  );

  await pruneOrganisationBackups(orgId, opts.retention ?? DEFAULT_RETENTION);

  logger.info(
    { orgId, backupId: saved.id, rows: content.meta.rows, sizeBytes: gzipped.length },
    "[tenant-backup] sauvegarde creee",
  );
  return { id: saved.id, sizeBytes: gzipped.length, rowCount: content.meta.rows, checksum };
}

/** Ne conserve que les `keep` sauvegardes les plus recentes de l'organisation. */
export async function pruneOrganisationBackups(orgId: number, keep: number): Promise<number> {
  const rows = await withDbRetry(
    () => db.select({ id: organisationBackupsTable.id })
      .from(organisationBackupsTable)
      .where(eq(organisationBackupsTable.organisationId, orgId))
      .orderBy(desc(organisationBackupsTable.createdAt))
      .offset(Math.max(0, keep)),
    { label: "tenant-backup:prune-list" },
  );
  if (rows.length === 0) return 0;

  await withDbRetry(
    () => db.delete(organisationBackupsTable).where(and(
      eq(organisationBackupsTable.organisationId, orgId),
      inArray(organisationBackupsTable.id, rows.map((r) => r.id)),
    )),
    { label: "tenant-backup:prune-delete" },
  );
  return rows.length;
}

/** Vrai si l'organisation a deja une sauvegarde depuis `since`. */
export async function hasBackupSince(orgId: number, since: Date): Promise<boolean> {
  const [row] = await withDbRetry(
    () => db.select({ id: organisationBackupsTable.id })
      .from(organisationBackupsTable)
      .where(and(
        eq(organisationBackupsTable.organisationId, orgId),
        sql`${organisationBackupsTable.createdAt} >= ${since.toISOString()}`,
      ))
      .limit(1),
    { label: "tenant-backup:has-recent" },
  );
  return !!row;
}

/** Relit et verifie une sauvegarde stockee (integrite + decompression). */
export function readStoredBackup(stored: { content: Buffer; checksum: string }): {
  json: string;
  valid: boolean;
} {
  const json = gunzipSync(stored.content).toString("utf8");
  const checksum = createHash("sha256").update(json).digest("hex");
  return { json, valid: checksum === stored.checksum };
}

/** Nom de fichier propose au telechargement. */
export function backupFileName(orgName: string | null, createdAt: Date): string {
  const slug = (orgName || "organisation")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "organisation";
  const stamp = createdAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `sauvegarde-${slug}-${stamp}.json.gz`;
}

/** Anciennes sauvegardes de TOUTES les organisations, au-dela de `days`. */
export async function purgeBackupsOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await withDbRetry(
    () => db.delete(organisationBackupsTable)
      .where(lt(organisationBackupsTable.createdAt, cutoff))
      .returning({ id: organisationBackupsTable.id }),
    { label: "tenant-backup:purge" },
  );
  return deleted.length;
}
