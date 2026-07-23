// Journal des scans de securite cote client (URL / fichiers / WhatsApp /
// appels), scope par organisation.
//
// Persiste desormais en base (table security_scans). La premiere version
// gardait tout en memoire — choix assume a l'epoque — mais Cloud Run arrete
// l'instance des que le trafic cesse: l'historique disparaissait donc
// regulierement, et deux instances simultanees n'affichaient pas le meme
// journal, alors que l'interface le presente comme un historique consultable.
// Un journal qui s'efface tout seul n'en est pas un.
//
// La signature publique est conservee, a ceci pres que les deux lectures sont
// devenues asynchrones.
import { db } from "@workspace/db";
import { securityScansTable } from "@workspace/db/schema";
import { desc, eq, lt, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export type ScanKind = "url" | "file" | "whatsapp" | "call" | "email";
export type ScanVerdict = "safe" | "suspicious" | "dangerous";

/**
 * Origine d'un verdict antivirus externe:
 *  - "lookup": empreinte SHA-256 deja connue (aucun contenu envoye).
 *  - "upload": fichier soumis a chaud (le contenu a quitte le serveur).
 */
export type ScanSource = "lookup" | "upload";

export interface SecurityScan {
  id: string;
  orgId: number;
  userId: number | null;
  kind: ScanKind;
  target: string;
  verdict: ScanVerdict;
  details: string;
  at: string;
  /** Moteur ayant produit le verdict (ex: "Heuristique", "VirusTotal"). */
  engine?: string;
  /** Origine d'un verdict externe (lookup d'empreinte vs soumission a chaud). */
  source?: ScanSource;
}

/**
 * Enregistre un verdict. Volontairement "fire-and-forget": un incident de base
 * ne doit jamais faire echouer l'analyse de securite qu'il accompagne, ni la
 * requete de l'utilisateur. Un verdict perdu est moins grave qu'un scan bloque.
 */
export function recordSecurityScan(input: {
  orgId: number;
  userId: number | null;
  kind: ScanKind;
  target: string;
  verdict: ScanVerdict;
  details: string;
  engine?: string;
  source?: ScanSource;
}): void {
  void (async () => {
    try {
      await db.insert(securityScansTable).values({
        organisationId: input.orgId,
        userId: input.userId,
        kind: input.kind,
        target: input.target.slice(0, 300),
        verdict: input.verdict,
        details: input.details.slice(0, 600),
        engine: input.engine ?? null,
        source: input.source ?? null,
      });
    } catch (err) {
      logger.warn({ err, orgId: input.orgId, kind: input.kind }, "[SecurityScans] Echec enregistrement du verdict");
    }
  })();
}

function toScan(row: typeof securityScansTable.$inferSelect): SecurityScan {
  return {
    id: String(row.id),
    orgId: row.organisationId,
    userId: row.userId,
    kind: row.kind as ScanKind,
    target: row.target,
    verdict: row.verdict as ScanVerdict,
    details: row.details,
    at: row.createdAt.toISOString(),
    engine: row.engine ?? undefined,
    source: (row.source as ScanSource | null) ?? undefined,
  };
}

export async function getRecentSecurityScans(orgId: number, limit = 50): Promise<SecurityScan[]> {
  try {
    const rows = await db.select().from(securityScansTable)
      .where(eq(securityScansTable.organisationId, orgId))
      .orderBy(desc(securityScansTable.createdAt))
      .limit(Math.min(limit, 200));
    return rows.map(toScan);
  } catch (err) {
    // Fail-soft: l'ecran de securite doit rester affichable meme si le journal
    // est momentanement illisible.
    logger.warn({ err, orgId }, "[SecurityScans] Lecture du journal impossible");
    return [];
  }
}

export async function getOrgScanSummary(orgId: number): Promise<{
  total: number;
  dangerous: number;
  suspicious: number;
  last24h: number;
}> {
  const empty = { total: 0, dangerous: 0, suspicious: 0, last24h: 0 };
  try {
    // Une seule requete agregee plutot que quatre lectures: ce resume est
    // recalcule a chaque ouverture de l'ecran de securite.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db.select({
      total: sql<number>`count(*)::int`,
      dangerous: sql<number>`count(*) filter (where ${securityScansTable.verdict} = 'dangerous')::int`,
      suspicious: sql<number>`count(*) filter (where ${securityScansTable.verdict} = 'suspicious')::int`,
      last24h: sql<number>`count(*) filter (where ${securityScansTable.createdAt} >= ${dayAgo})::int`,
    }).from(securityScansTable).where(eq(securityScansTable.organisationId, orgId));
    if (!row) return empty;
    return {
      total: Number(row.total ?? 0),
      dangerous: Number(row.dangerous ?? 0),
      suspicious: Number(row.suspicious ?? 0),
      last24h: Number(row.last24h ?? 0),
    };
  } catch (err) {
    logger.warn({ err, orgId }, "[SecurityScans] Resume indisponible");
    return empty;
  }
}

/**
 * Purge des verdicts anciens. Sans borne, cette table grossit indefiniment
 * alors que sa valeur est essentiellement recente.
 */
export async function purgeOldSecurityScans(olderThanDays = 90): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const rows = await db.delete(securityScansTable)
      .where(lt(securityScansTable.createdAt, cutoff))
      .returning({ id: securityScansTable.id });
    if (rows.length > 0) logger.info({ count: rows.length, olderThanDays }, "[SecurityScans] Verdicts anciens purges");
    return rows.length;
  } catch (err) {
    logger.warn({ err }, "[SecurityScans] Purge impossible");
    return 0;
  }
}
