import { pgTable, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Compteur des factures que la PLATEFORME emet a ses propres clients.
 *
 * A ne pas confondre avec `invoice_sequences`, qui numerote les factures que
 * chaque organisation cliente emet a SES clients. Ici l'emetteur est unique —
 * l'editeur — donc la sequence l'est aussi: une seule suite par annee, tous
 * clients confondus. Deux clients ne peuvent pas recevoir le meme numero, et
 * l'article 242 nonies A de l'annexe II au CGI impose une « sequence
 * chronologique continue, sans rupture » a l'echelle de l'emetteur, pas du
 * destinataire.
 *
 * C'est aussi pourquoi cette table n'a pas de colonne `organisation_id`: la
 * reutilisation de `invoice_sequences` aurait demande une organisation
 * fictive pour porter la cle etrangere, et un numero de la plateforme se
 * serait mele a ceux d'un locataire.
 */
export const platformInvoiceSequencesTable = pgTable("platform_invoice_sequences", {
  /** Annee civile de la sequence, et cle primaire. */
  year: integer("year").primaryKey(),
  /** Dernier numero attribue. La prochaine facture prend `lastNumber + 1`. */
  lastNumber: integer("last_number").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformInvoiceSequence = typeof platformInvoiceSequencesTable.$inferSelect;
