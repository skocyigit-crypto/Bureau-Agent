import { pgTable, serial, integer, text, timestamp, jsonb, index, customType } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

/**
 * Contenu binaire de l'export (JSON compresse en gzip). `bytea` plutot que du
 * texte: on evite le surcout base64 (+33 %) sur la ligne la plus lourde de la
 * table.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Sauvegardes d'une organisation, prises quotidiennement et telechargeables par
 * le client lui-meme.
 *
 * Pourquoi cette table existe: la seule protection en place etait celle de
 * l'infrastructure (sauvegardes automatiques Cloud SQL, 7 jours, PITR). Elle
 * couvre la perte d'une base, pas la perte d'un client: une suppression
 * accidentelle, un import rate, un enregistrement ecrase. Et surtout, le client
 * n'avait aucun moyen de recuperer SES donnees par lui-meme — l'ecran
 * « Sauvegardes » appelait des routes qui n'existaient pas.
 *
 * Le contenu ne porte QUE les lignes de l'organisation concernee, et les
 * colonnes de secrets en sont retirees (cf. services/tenant-backup.ts): un
 * export telecharge puis egare ne doit pas livrer les jetons d'integration ni
 * les empreintes de mots de passe.
 */
export const organisationBackupsTable = pgTable("organisation_backups", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** `auto` (cron quotidien) ou `manual` (bouton du client). */
  origin: text("origin").notNull().default("auto"),
  /** Renseigne pour une sauvegarde manuelle: qui l'a declenchee. */
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  /** Nombre de lignes exportees par table, pour afficher et verifier. */
  tableCounts: jsonb("table_counts").$type<Record<string, number>>().notNull().default({}),
  rowCount: integer("row_count").notNull().default(0),
  /** Taille du gzip stocke. */
  sizeBytes: integer("size_bytes").notNull().default(0),
  /** SHA-256 du JSON non compresse: integrite verifiable au telechargement. */
  checksum: text("checksum").notNull(),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("organisation_backups_org_created_idx").on(table.organisationId, table.createdAt),
]);

export type OrganisationBackup = typeof organisationBackupsTable.$inferSelect;
export type InsertOrganisationBackup = typeof organisationBackupsTable.$inferInsert;
