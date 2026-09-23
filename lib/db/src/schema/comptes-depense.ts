import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

/**
 * Compte comptable associe a une categorie de depense, PAR ORGANISATION.
 *
 * POURQUOI CE N'EST PAS UNE CONSTANTE DU CODE.
 *
 * Le registre remis au comptable portait la categorie du produit
 * (« sous_traitance », « carburant »...), jamais le compte ou l'ecriture doit
 * aller. Le comptable refaisait donc le rapprochement a la main, dossier par
 * dossier.
 *
 * Mais le compte JUSTE depend du cabinet et du marche : dans le batiment, la
 * sous-traitance se ventile entre 604 (achats d'etudes et prestations) et 611
 * (sous-traitance generale) selon la nature du contrat, et l'expert-comptable
 * du client a son avis — qui fait foi. Figer un numero dans le code aurait
 * l'air universel sans l'etre, et personne ne pourrait le corriger.
 *
 * D'ou : une table par organisation, vide tant que le client n'a rien choisi,
 * avec des valeurs PROPOSEES a l'ecran. Une proposition se discute, une
 * constante se subit.
 *
 * LA CLASSE NE SE SAISIT PAS : elle est le premier chiffre du numero (6 pour
 * une charge, 7 pour un produit, 4 pour un compte de tiers). Un 606 range en
 * produit ne fausse pas une ligne, il fausse le RESULTAT dans le sens
 * flatteur, et l'ecart se decouvre a l'arrete des comptes quand plus personne
 * ne sait d'ou il vient. (Regle relevee par la session Assise, 23/09/2026.)
 */
export const comptesDepenseTable = pgTable("comptes_depense", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Categorie de depense du produit (EXPENSE_CATEGORIES). */
  categorie: text("categorie").notNull(),
  /** Compte de charge, classe 6 (ex. « 604000 »). */
  compteCharge: text("compte_charge").notNull(),
  /** Compte de TVA deductible, classe 4 (ex. « 445660 »). Facultatif. */
  compteTva: text("compte_tva"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("comptes_depense_org_categorie_unique").on(table.organisationId, table.categorie),
]);

export type CompteDepense = typeof comptesDepenseTable.$inferSelect;
