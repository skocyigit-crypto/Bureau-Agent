import { pgTable, serial, integer, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

/**
 * Corbeille — ce qui a ete supprime, et de quoi le remettre.
 *
 * Rien dans ce produit ne protegeait d'une suppression par erreur. Les 42
 * suppressions du serveur effacent la ligne pour de bon; aucune table ne porte
 * de `deleted_at`. Le seul recours etait la sauvegarde quotidienne, ce qui
 * laisse un trou que personne ne voit avant de tomber dedans: **ce qui est cree
 * puis supprime entre deux sauvegardes n'a jamais existe pour elles**. Une
 * facture saisie le matin et effacee l'apres-midi etait irrecuperable, et la
 * restauration etait de toute facon reservee aux administrateurs.
 *
 * La ligne entiere est conservee en JSON plutot que d'ajouter un `deleted_at`
 * a chaque table. Le compromis est deliberé: un drapeau oblige CHAQUE lecture
 * du depot a le filtrer, et une seule requete oubliee fait reapparaitre une
 * donnee supprimee — ou la compte deux fois dans un total. Ici, aucune lecture
 * existante ne change: la ligne est vraiment partie de sa table, et la
 * corbeille est un journal a part.
 */
export const deletedRowsTable = pgTable("deleted_rows", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Nom de la table d'origine, tel qu'il figure dans `RESTORABLE_TABLES`. */
  tableName: varchar("table_name", { length: 64 }).notNull(),
  /** Identifiant que la ligne portait: c'est lui qu'on remet. */
  rowId: integer("row_id").notNull(),
  /** Libelle lisible (titre, reference, nom) pour que la corbeille soit lisible. */
  label: varchar("label", { length: 255 }),
  /** La ligne complete, telle qu'elle etait juste avant la suppression. */
  payload: jsonb("payload").notNull(),
  deletedByUserId: integer("deleted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** Nom fige: le compte peut disparaitre, la trace doit rester lisible. */
  deletedByName: varchar("deleted_by_name", { length: 255 }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("deleted_rows_org_deleted_at_idx").on(table.organisationId, table.deletedAt),
]);

export type DeletedRow = typeof deletedRowsTable.$inferSelect;
