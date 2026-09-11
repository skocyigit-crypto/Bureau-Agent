import { pgTable, serial, integer, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

/**
 * Clotures comptables: la condition de CONSERVATION du 3° bis du I de
 * l'article 286 du CGI.
 *
 * Le chainage des encaissements attrape la MODIFICATION d'une ecriture. Il
 * n'attrape pas la suppression de la FIN du journal: retirer les trois
 * dernieres lignes laisse une chaine parfaitement valide — numeros continus,
 * empreintes qui s'accrochent. C'est pourtant la fraude la plus simple qui
 * soit: encaisser en especes, puis effacer la ligne le soir.
 *
 * Chaque cloture fige un TOTAL CUMULE depuis l'origine, qui ne se remet jamais
 * a zero. Des annees plus tard, un controleur compare deux nombres: la somme
 * des ecritures presentes et le cumul fige a l'epoque. L'ecart dit combien
 * manque.
 *
 *     chainage   -> une ecriture a ete MODIFIEE
 *     clotures   -> une ecriture a ete SUPPRIMEE
 *
 * Les clotures sont chainees entre elles pour la meme raison qu'on chaine les
 * ecritures: un cumul fige qu'on pourrait reecrire ne fige rien.
 *
 * Comme le journal, cette table est en AJOUT SEUL: une cloture ne se modifie
 * ni ne se supprime. Une periode close le reste.
 */
export const cloturesComptablesTable = pgTable("clotures_comptables", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** "journaliere" | "mensuelle" | "annuelle". */
  type: varchar("type", { length: 20 }).notNull(),
  /** "2026-09-11" (jour), "2026-09" (mois), "2026" (annee). */
  periode: varchar("periode", { length: 10 }).notNull(),
  premierNumero: integer("premier_numero"),
  dernierNumero: integer("dernier_numero"),
  nbEcritures: integer("nb_ecritures").notNull().default(0),
  /** Somme de la periode, en centimes entiers. */
  totalPeriodeCentimes: integer("total_periode_centimes").notNull().default(0),
  /**
   * Somme depuis l'origine, en centimes entiers. Ne se remet jamais a zero —
   * ni a la fin du mois, ni a la fin de l'exercice. Un total qui repartirait
   * de zero ne prouverait plus rien sur les periodes precedentes.
   */
  totalCumuleCentimes: integer("total_cumule_centimes").notNull().default(0),
  empreintePrecedente: text("empreinte_precedente").notNull(),
  empreinte: text("empreinte").notNull(),
  /** Qui a declenche la cloture. Null quand c'est la tache planifiee. */
  clotureePar: integer("cloturee_par").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Une periode ne se clot qu'une fois par type. C'est la base qui le garantit:
  // deux instances Cloud Run peuvent lancer la cloture du soir au meme instant.
  uniqueIndex("clotures_org_type_periode_unique").on(table.organisationId, table.type, table.periode),
  index("clotures_org_type_idx").on(table.organisationId, table.type),
]);

export type ClotureComptable = typeof cloturesComptablesTable.$inferSelect;
export type InsertClotureComptable = typeof cloturesComptablesTable.$inferInsert;
