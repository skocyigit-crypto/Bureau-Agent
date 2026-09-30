import { pgTable, serial, integer, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { projetsTable } from "./projets";
import { usersTable } from "./users";

/**
 * Journal de chantier : ce qui s'est passe sur le site, un jour, sur un
 * chantier donne.
 *
 * A ne pas confondre avec `daily_reports`, qui est un bilan d'activite du
 * bureau genere par l'IA a l'echelle de l'organisation (appels, taches,
 * messages). Celui-la est saisi par la personne qui etait sur place, et il ne
 * porte que sur un chantier.
 *
 * A quoi il sert, concretement : quand le client conteste un retard ou un
 * travail supplementaire, la seule chose qu'on peut lui opposer est ce qui a
 * ete note le jour meme — qui etait la, quel temps il faisait, ce qui a bloque.
 * Reconstitue trois mois plus tard, ce recit ne vaut rien.
 *
 * Deliberement PAS dans cette table :
 *
 *   - aucun champ « avancement en % » redige par un agent. Un pourcentage
 *     d'avancement engage une situation de travaux, donc un paiement ; il se
 *     saisit, il ne se devine pas ;
 *
 *   - aucun statut « valide » pose automatiquement. `redigePar` est l'auteur
 *     humain de la note. Un agent peut proposer un brouillon (`brouillon` a
 *     vrai), et c'est un humain qui le fait passer au journal.
 *
 * Les photos ne sont pas stockees ici : elles vivent dans `documents`
 * (`entityType = "journal_chantier"`, `entityId` = cette ligne), qui porte deja
 * l'analyse antivirus et l'extraction.
 */
export const journalChantierTable = pgTable("journal_chantier", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  // Le chantier est obligatoire : une note de journal sans chantier n'est pas
  // un journal de chantier. Si le chantier est supprime, ses notes partent
  // avec lui (cascade) — elles n'ont plus de sujet.
  projetId: integer("projet_id").notNull().references(() => projetsTable.id, { onDelete: "cascade" }),
  /** Jour decrit, en AAAA-MM-JJ. Texte, pas timestamp : c'est une date civile
   *  sur le chantier, sans heure et sans fuseau a interpreter. */
  jour: text("jour").notNull(),
  /** Meteo telle qu'observee. Elle justifie un arret de chantier : c'est la
   *  cause d'intemperies la plus souvent invoquee, et la moins souvent notee. */
  meteo: text("meteo"),
  /** Nombre de compagnons presents. Nullable : on ne comble pas par 0 une
   *  presence qui n'a pas ete comptee — 0 voudrait dire « personne ». */
  effectif: integer("effectif"),
  /** Travaux realises dans la journee, en clair. */
  travaux: text("travaux").notNull(),
  /** Ce qui a bloque : livraison manquante, acces ferme, co-activite. */
  incidents: text("incidents"),
  /** Observations libres, remarques du client sur place. */
  observations: text("observations"),
  /** Vrai tant que la note est une proposition (saisie partielle, ou brouillon
   *  redige depuis une note vocale) et n'est pas entree au journal. */
  brouillon: boolean("brouillon").notNull().default(false),
  /** L'auteur humain. Nullable si son compte a ete supprime depuis. */
  redigePar: integer("redige_par").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Un chantier, un jour, une note. Deux notes pour le meme jour, ce sont deux
  // recits concurrents du meme fait : on complete la note du jour, on n'en
  // ouvre pas une seconde. La base le garantit, pas le code : deux instances
  // Cloud Run peuvent enregistrer au meme instant.
  uniqueIndex("journal_chantier_projet_jour_uq").on(table.projetId, table.jour),
  index("journal_chantier_org_idx").on(table.organisationId),
  index("journal_chantier_projet_jour_idx").on(table.projetId, table.jour),
]);

export const insertJournalChantierSchema = createInsertSchema(journalChantierTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJournalChantier = z.infer<typeof insertJournalChantierSchema>;
export type JournalChantier = typeof journalChantierTable.$inferSelect;
