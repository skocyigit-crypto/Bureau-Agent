/**
 * Corbeille — rattraper une suppression faite par erreur.
 *
 * Etat avant: 42 suppressions definitives cote serveur, aucune table portant
 * un `deleted_at`, et pour seul recours la sauvegarde quotidienne. Le trou
 * n'est visible qu'une fois qu'on est tombe dedans: **ce qui est cree puis
 * supprime entre deux sauvegardes n'a jamais existe pour elles**. Une facture
 * saisie le matin et effacee l'apres-midi etait perdue, et la restauration
 * etait de toute facon reservee aux administrateurs — alors que la personne
 * qui se trompe est le plus souvent celle qui n'a pas ce role.
 *
 * Deux garde-fous encadrent la remise en place, et ils viennent tous deux de
 * `tenant-restore`, ecrit pour la restauration de sauvegarde:
 *
 *   1. Seules les tables de `RESTORABLE_TABLES` sont acceptees. Cette liste
 *      exclut deliberement `users`, `api_keys` et les abonnements —
 *      reinjecter un compte ou un abonnement supprime serait une faille, pas
 *      un service. La corbeille ne doit pas rouvrir ce que cette liste ferme.
 *   2. La remise en place n'AJOUTE que ce qui manque (`ON CONFLICT DO
 *      NOTHING`) et force `organisation_id`. Elle n'ecrase jamais une ligne
 *      existante: le pire resultat d'une fonction censee proteger des donnees
 *      serait d'en detruire en pretendant en sauver.
 */

import { and, desc, eq, getTableColumns, getTableName, lt, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, deletedRowsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { RESTORABLE_TABLES } from "./tenant-restore";

/**
 * Duree de retention de la corbeille, en jours.
 *
 * Exportee pour que toute declaration faite a l'utilisateur lise CETTE valeur
 * plutot que de repeter le nombre — une duree annoncee qui differe de celle
 * appliquee est invisible et fausse.
 *
 * 30 jours: assez long pour couvrir une absence ou un retour de conges, assez
 * court pour ne pas transformer la corbeille en second entrepot de donnees
 * personnelles que plus personne ne surveille (art. 5.1.e).
 */
export const TRASH_RETENTION_DAYS = 30;

/** Tables dont une suppression peut etre annulee. */
const RESTORABLE = new Set<string>(RESTORABLE_TABLES);

export function isRestorableTable(table: string): boolean {
  return RESTORABLE.has(table);
}

export interface DeletionContext {
  orgId: number;
  userId?: number | null;
  userName?: string | null;
}

/**
 * Contexte de suppression a partir de la requete.
 *
 * Type structurel plutot qu'un import d'Express: ce module ne connait pas le
 * HTTP, et le garder ainsi permet de l'appeler depuis un cron ou un script.
 */
export function deletionContext(
  req: { session?: { userId?: number; userEmail?: string; prenom?: string } },
  orgId: number,
): DeletionContext {
  return {
    orgId,
    userId: req.session?.userId ?? null,
    userName: req.session?.userEmail ?? req.session?.prenom ?? null,
  };
}

/**
 * Un libelle lisible, pour que la corbeille ne soit pas une liste
 * d'identifiants. On prend le premier champ parlant que la ligne possede;
 * aucune ligne n'est rejetee faute de libelle.
 */
function labelOf(row: Record<string, unknown>): string | null {
  for (const key of ["reference", "title", "titre", "name", "nom", "subject", "description"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 255);
  }
  return null;
}

/**
 * Consigne des lignes supprimees.
 *
 * Ne leve JAMAIS: la suppression demandee par l'utilisateur a deja eu lieu
 * quand on arrive ici, et faire echouer sa requete parce que la corbeille est
 * indisponible transformerait une protection en panne. L'echec est journalise
 * — c'est ce qui permet de s'apercevoir que le filet ne retient plus rien.
 */
export async function archiveDeletedRows(
  /**
   * La TABLE, pas son nom.
   *
   * Deux raisons, et la premiere a ete trouvee par un test contre une vraie
   * base plutot que par relecture. `db.delete(...).returning()` rend les
   * champs sous leur nom JavaScript (`organisationId`, `createdAt`), alors
   * que la remise en place construit un `INSERT` avec des noms de COLONNES
   * (`organisation_id`, `created_at`). Archiver la ligne telle quelle
   * produisait une entree de corbeille qui s'affichait normalement et
   * echouait a la restauration — la pire forme du defaut, puisqu'elle promet
   * a l'utilisateur exactement ce qu'elle ne tiendra pas. La table porte la
   * correspondance entre les deux; on la lit ici.
   *
   * Ensuite, le nom en est deduit: un appelant ne peut plus archiver des
   * lignes de `devis` sous l'etiquette `factures_client`.
   */
  table: PgTable,
  rows: Array<Record<string, unknown>>,
  ctx: DeletionContext,
): Promise<number> {
  const tableName = getTableName(table);
  if (rows.length === 0) return 0;
  if (!isRestorableTable(tableName)) {
    // Table hors perimetre: on ne conserve rien plutot que de conserver ce
    // qu'on ne saura pas remettre — une corbeille dont les entrees ne se
    // restaurent pas ment a celui qui la consulte.
    return 0;
  }
  try {
    // Nom JavaScript -> nom de colonne, tel que la table le declare.
    const columns = getTableColumns(table) as Record<string, { name: string }>;
    const toColumnNames = (row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [prop, value] of Object.entries(row)) {
        const column = columns[prop];
        // Un champ inconnu de la table ne peut pas etre reinsere: le garder
        // ferait echouer l'INSERT entier au moment ou l'utilisateur en a le
        // plus besoin.
        if (column) out[column.name] = value;
      }
      return out;
    };

    const values = rows
      .filter((row) => row && row.id != null)
      .map((row) => ({
        organisationId: ctx.orgId,
        tableName,
        rowId: Number(row.id),
        label: labelOf(row),
        payload: toColumnNames(row),
        deletedByUserId: ctx.userId ?? null,
        deletedByName: ctx.userName ?? null,
      }));
    if (values.length === 0) return 0;
    await db.insert(deletedRowsTable).values(values);
    return values.length;
  } catch (err) {
    logger.error({ err, tableName, orgId: ctx.orgId }, "[trash] archivage impossible");
    return 0;
  }
}

export interface TrashEntry {
  id: number;
  tableName: string;
  rowId: number;
  label: string | null;
  deletedByName: string | null;
  deletedAt: Date;
}

/** Contenu de la corbeille d'une organisation, du plus recent au plus ancien. */
export async function listTrash(orgId: number, limit = 100): Promise<TrashEntry[]> {
  return db.select({
    id: deletedRowsTable.id,
    tableName: deletedRowsTable.tableName,
    rowId: deletedRowsTable.rowId,
    label: deletedRowsTable.label,
    deletedByName: deletedRowsTable.deletedByName,
    deletedAt: deletedRowsTable.deletedAt,
  }).from(deletedRowsTable)
    .where(eq(deletedRowsTable.organisationId, orgId))
    .orderBy(desc(deletedRowsTable.deletedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

export type RestoreOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "table_not_restorable" | "insert_failed" };

/**
 * Remet une ligne en place, puis retire son entree de la corbeille.
 *
 * L'entree n'est retiree QU'APRES un insert reussi: si la remise echoue — le
 * parent a lui-meme ete supprime, par exemple — l'utilisateur garde sa
 * derniere chance au lieu de perdre la ligne deux fois.
 */
export async function restoreFromTrash(orgId: number, entryId: number): Promise<RestoreOutcome> {
  const [entry] = await db.select().from(deletedRowsTable)
    .where(and(eq(deletedRowsTable.id, entryId), eq(deletedRowsTable.organisationId, orgId)));
  if (!entry) return { ok: false, reason: "not_found" };

  // Deuxieme controle, apres celui de l'archivage: le nom de table vient de la
  // base et non de l'appelant, mais il sert a construire du SQL. On ne fait
  // pas confiance a une valeur stockee pour cela.
  if (!isRestorableTable(entry.tableName)) return { ok: false, reason: "table_not_restorable" };

  const payload: Record<string, unknown> = {
    ...(entry.payload as Record<string, unknown>),
    // L'organisation est reimposee: une entree ne peut pas servir a ecrire
    // chez un autre locataire, meme si son contenu a ete altere en base.
    organisation_id: orgId,
  };
  const columns = Object.keys(payload);
  const identifiers = sql.join(columns.map((c) => sql.identifier(c)), sql`, `);
  const values = sql.join(columns.map((c) => sql`${payload[c] as never}`), sql`, `);

  try {
    await db.execute(sql`
      INSERT INTO ${sql.identifier(entry.tableName)} (${identifiers})
      VALUES (${values})
      ON CONFLICT DO NOTHING
    `);
  } catch (err) {
    logger.warn({ err, orgId, entryId, table: entry.tableName }, "[trash] restauration impossible");
    return { ok: false, reason: "insert_failed" };
  }

  await db.delete(deletedRowsTable).where(eq(deletedRowsTable.id, entryId));
  return { ok: true };
}

/**
 * Vide les entrees expirees. Appelee par `retention-cron`: une corbeille sans
 * terme est un second entrepot de donnees personnelles que plus personne ne
 * regarde, ce que l'article 5.1.e interdit.
 */
export async function purgeExpiredTrash(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86400_000);
    const rows = await db.delete(deletedRowsTable)
      .where(lt(deletedRowsTable.deletedAt, cutoff))
      .returning({ id: deletedRowsTable.id });
    if (rows.length > 0) {
      logger.info({ count: rows.length, retentionDays: TRASH_RETENTION_DAYS }, "[trash] entrees expirees purgees");
    }
    return rows.length;
  } catch (err) {
    logger.error({ err }, "[trash] purge impossible");
    return 0;
  }
}
