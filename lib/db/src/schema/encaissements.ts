import { pgTable, serial, integer, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { facturesClientTable } from "./factures-client";
import { usersTable } from "./users";

/**
 * Journal des reglements encaisses par le client aupres de SES clients.
 *
 * Le 3° bis du I de l'article 286 du CGI impose aux assujettis qui enregistrent
 * les reglements de leurs clients un logiciel satisfaisant quatre conditions:
 * inalterabilite, securisation, conservation, archivage. L'amende est de
 * 7 500 € PAR LOGICIEL non conforme, et elle frappe l'entreprise utilisatrice
 * — donc le client de ce produit, pas son editeur.
 *
 * Le champ d'application compte: une entreprise dont TOUT le chiffre d'affaires
 * est realise avec des professionnels en est exclue. Une entreprise qui
 * encaisse aussi des particuliers y entre. Les artisans du batiment
 * travaillent presque tous pour des particuliers en plus de leurs clients
 * professionnels: une large part des utilisateurs est dans le champ.
 *
 * CE QUI EXISTAIT AVANT
 *
 * Rien. Les encaissements vivaient dans une seule colonne modifiable,
 * `factures_client.paid_amount`, explicitement laissee hors des champs geles
 * apres emission — un montant encaisse pouvait etre augmente, diminue ou remis
 * a zero sans aucune trace. Cette table la remplace comme SOURCE DE VERITE;
 * `paid_amount` reste un cache d'affichage, calcule depuis le journal.
 *
 * REGLES QUI TIENNENT L'INALTERABILITE
 *
 *   - on n'ecrit QUE des lignes nouvelles. Aucun UPDATE, aucun DELETE: une
 *     correction se fait par une ecriture inverse (`sens = "annulation"`), qui
 *     s'ajoute a la suite. C'est la regle comptable ordinaire — on ne gomme
 *     pas, on contre-passe;
 *
 *   - chaque ligne porte l'empreinte de la precedente. Modifier une ligne
 *     ancienne casse tous les chainons suivants: la falsification cesse d'etre
 *     discrete pour devenir arithmetiquement detectable (cf.
 *     services/chainage-encaissements.ts, ou le calcul est pur et testable);
 *
 *   - le numero est unique PAR ORGANISATION et sans trou. Un trou signale une
 *     suppression, et la contrainte d'unicite empeche deux instances Cloud Run
 *     d'attribuer le meme numero au meme instant.
 */
export const encaissementsTable = pgTable("encaissements", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /**
   * Numero de suite DANS l'organisation, strictement croissant, sans trou.
   * C'est lui que la verification suit, pas `id`: un `serial` global sauterait
   * a chaque ecriture d'une autre organisation.
   */
  numero: integer("numero").notNull(),
  factureId: integer("facture_id").references(() => facturesClientTable.id, { onDelete: "set null" }),
  /**
   * Montant en CENTIMES, entier signe.
   *
   * Ni flottant ni decimal: l'empreinte doit etre reproductible a l'octet
   * pres, et un controleur qui refait le calcul doit retrouver exactement la
   * meme valeur. Un montant negatif est une contre-passation.
   */
  montantCentimes: integer("montant_centimes").notNull(),
  devise: varchar("devise", { length: 3 }).notNull().default("EUR"),
  /** Especes, virement, cheque, carte... — tel que saisi. */
  moyen: varchar("moyen", { length: 30 }).notNull(),
  dateEncaissement: timestamp("date_encaissement", { withTimezone: true }).notNull(),
  /** "encaissement" ou "annulation". */
  sens: varchar("sens", { length: 20 }).notNull().default("encaissement"),
  /** Pour une annulation: le `numero` de l'ecriture contre-passee. */
  annuleNumero: integer("annule_numero"),
  /** Empreinte de l'ecriture precedente, ou la graine de l'organisation. */
  empreintePrecedente: text("empreinte_precedente").notNull(),
  /** Empreinte de cette ecriture. */
  empreinte: text("empreinte").notNull(),
  /**
   * Qui a saisi. Conserve pour la piste d'audit (art. 289 VII 1° du CGI):
   * une ecriture doit pouvoir etre rattachee a son auteur.
   */
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Deux ecritures ne peuvent jamais partager un numero dans la meme
  // organisation. C'est la base a laquelle on confie l'unicite, pas le code:
  // deux instances Cloud Run peuvent lire le meme dernier numero au meme
  // instant.
  uniqueIndex("encaissements_org_numero_unique").on(table.organisationId, table.numero),
  index("encaissements_org_idx").on(table.organisationId),
  index("encaissements_facture_idx").on(table.factureId),
  index("encaissements_date_idx").on(table.dateEncaissement),
]);

export type Encaissement = typeof encaissementsTable.$inferSelect;
export type InsertEncaissement = typeof encaissementsTable.$inferInsert;
