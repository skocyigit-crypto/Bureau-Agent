import { pgTable, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

/**
 * Compteur de numerotation des factures, par organisation et par annee.
 *
 * Pourquoi une table plutot qu'un identifiant aleatoire. L'article 242 nonies A
 * de l'annexe II au CGI impose un numero « base sur une sequence chronologique
 * continue, sans rupture ». Le produit generait jusqu'ici
 * `FAC-M4K2J1-A9F03B`: horodatage en base 36 plus trois octets aleatoires.
 * C'est unique, mais ce n'est pas une sequence — et une entreprise qui emet ses
 * factures avec ce logiciel ne peut pas justifier sa numerotation lors d'un
 * controle. Le risque n'est pas pour l'editeur seul: il est chez chaque client.
 *
 * Le compteur est incremente sous verrou de ligne (`SELECT ... FOR UPDATE`), et
 * non par un `SELECT max()+1` qui, avec trois instances Cloud Run, donnerait
 * deux fois le meme numero au meme instant.
 *
 * La sequence est PAR ORGANISATION: deux locataires n'ont aucune raison de
 * partager une numerotation, et un trou chez l'un ne doit pas se voir chez
 * l'autre. Elle est aussi PAR ANNEE, ce qui est l'usage courant et rend le
 * numero lisible (`FAC-2026-000001`).
 */
export const invoiceSequencesTable = pgTable("invoice_sequences", {
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Annee civile de la sequence. */
  year: integer("year").notNull(),
  /** Dernier numero attribue. La prochaine facture prend `lastNumber + 1`. */
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.organisationId, table.year] }),
]);

export type InvoiceSequence = typeof invoiceSequencesTable.$inferSelect;
