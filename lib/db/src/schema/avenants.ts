import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { projetsTable } from "./projets";
import { devisTable } from "./devis";
import { usersTable } from "./users";

/**
 * AVENANTS : les travaux supplementaires demandes pendant un chantier.
 *
 * Le travail en plus demande en cours de chantier est un contrat NOUVEAU. Il
 * exige son propre prix et son propre accord ecrit. Glisse dans le marche
 * initial, il est execute sans devis accepte — et l'entreprise n'a rien a
 * opposer au client qui refuse de le payer a la reception. C'est le litige de
 * chantier le plus courant, et il naissait ici d'une absence : avant cette
 * table, le mot « avenant » n'existait nulle part dans le depot. Le seul geste
 * possible etait de modifier le devis initial, c'est-a-dire de faire
 * disparaitre le prix sur lequel le client s'etait engage.
 *
 * POURQUOI UNE TABLE, ET PAS DEUX COLONNES SUR `devis`
 *
 * L'evidence disait : `devis.projetId` + `devis.nature`. Mais `projets`
 * reference deja `devis` (le marche dont le chantier est l'execution), et le
 * retour rendait le cycle insoluble pour TypeScript : les deux tables
 * retombaient a `any`, c'est-a-dire que tout le typage de `devis` et de
 * `projets` — utilises partout — disparaissait en silence.
 *
 * La table de liaison rompt le cycle, et se trouve dire la chose plus
 * exactement : etre un avenant n'est pas une propriete du devis, c'est une
 * RELATION entre un devis et un chantier. Il y a donc UN seul endroit ou lire
 * si un devis est un avenant — l'existence de sa ligne ici. Avec une colonne
 * `nature` en plus, les deux auraient fini par se contredire.
 *
 * CE QUI EST GARANTI PAR LA BASE, PAS PAR LE CODE
 *
 *   - un devis n'est l'avenant que d'UN chantier (`avenants_devis_uq`). Deux
 *     lignes, ce serait le meme supplement compte deux fois dans l'engage ;
 *   - le chantier et le devis disparaissent avec l'organisation, et la ligne
 *     avec le chantier : un avenant sans chantier n'a plus d'objet.
 *
 * CE QUI N'EST PAS ICI, ET POURQUOI
 *
 * Aucun montant. Le prix de l'avenant est celui de son devis, et une somme
 * recopiee dans deux tables finit toujours par diverger. Aucun statut non
 * plus : un avenant compte dans l'engage du chantier quand SON DEVIS est
 * accepte (`devis.status = "accepte"`), pas quand quelqu'un a coche une case
 * ici. Voir `services/dossier-chantier.ts`, qui ne somme que les acceptes.
 */
export const avenantsTable = pgTable("avenants", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Le chantier dont les travaux sont modifies. */
  projetId: integer("projet_id").notNull().references(() => projetsTable.id, { onDelete: "cascade" }),
  /** Le devis qui chiffre le supplement. C'est lui qui porte le prix et l'accord. */
  devisId: integer("devis_id").notNull().references(() => devisTable.id, { onDelete: "cascade" }),
  /**
   * Pourquoi ce supplement existe : ce que le client a demande en plus, ou ce
   * qu'on a decouvert en ouvrant. Obligatoire — un avenant sans motif est
   * exactement ce qu'on ne peut pas defendre trois mois plus tard.
   */
  motif: text("motif").notNull(),
  /** Qui l'a ouvert. Nullable si son compte a ete supprime depuis. */
  ouvertPar: integer("ouvert_par").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("avenants_devis_uq").on(table.devisId),
  index("avenants_projet_idx").on(table.projetId),
  index("avenants_org_idx").on(table.organisationId),
]);

export type Avenant = typeof avenantsTable.$inferSelect;
export type InsertAvenant = typeof avenantsTable.$inferInsert;
