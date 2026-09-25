import { pgTable, serial, integer, text, timestamp, index, boolean } from "drizzle-orm/pg-core";
// @ts-ignore - postgres text array
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone").notNull(),
  mobile: text("mobile"),
  category: text("category").notNull().default("autre"),

  // --- Demarchage commercial -----------------------------------------------
  //
  // Loi n 2025-594 du 30 juin 2025, en vigueur depuis le 11 AOUT 2026 :
  // appeler un CONSOMMATEUR a des fins de prospection sans son consentement
  // prealable, libre, specifique, eclaire et univoque est desormais interdit.
  // Bloctel, dont la concession s'achevait a cette date, n'a plus d'objet.
  // L'amende atteint 375 000 EUR pour une personne morale.
  //
  // Le B2B echappe a cet opt-in : la prospection d'un professionnel reste
  // fondee sur l'interet legitime, sous reserve d'information et du droit
  // d'opposition. D'ou la necessite de SAVOIR a qui l'on parle — ce que la
  // colonne `category`, texte libre par defaut « autre », ne dit pas.
  //
  // Une PME du BTP travaille couramment pour des particuliers : ce n'est pas
  // un cas marginal ici.
  typePersonne: text("type_personne").notNull().default("inconnu"),

  // "accorde" | "refuse" | "inconnu". Un consentement INCONNU n'est pas un
  // consentement : il vaut refus pour un consommateur.
  prospectionConsent: text("prospection_consent").notNull().default("inconnu"),
  prospectionConsentAt: timestamp("prospection_consent_at", { withTimezone: true }),

  // Droit d'opposition (RGPD art. 21). Il s'exerce a tout moment et prime
  // sur tout le reste, y compris en B2B.
  prospectionOppositionAt: timestamp("prospection_opposition_at", { withTimezone: true }),
  /**
   * Ce client a demande a ne PAS etre relance automatiquement.
   *
   * La garde existait deja dans le code des relances — elle interrogeait
   * `compte_client.auto_reminder_enabled`. Mais rien n'a jamais rempli cette
   * table, et aucun ecran ne proposait le reglage : le filtre etait toujours
   * vide, et un client qui avait demande qu'on cesse les relances automatiques
   * en recevait quand meme. Une garde qui ne garde rien est pire qu'une garde
   * absente : on croit le sujet traite.
   *
   * Le reglage vit ici, sur le CONTACT, qui est la chose que l'utilisateur
   * ouvre et modifie. Les relances partent vers les clients de
   * l'organisation : un envoi non voulu est un incident commercial, pas un
   * detail d'affichage.
   */
  relancesAutoDesactivees: boolean("relances_auto_desactivees").notNull().default(false),
  address: text("address"),
  /**
   * Etiquettes libres, comme sur les prospects et les projets.
   *
   * La colonne manquait alors que la route `PATCH /contacts/:id/tags` et le
   * bouton de la fiche contact existaient tous les deux : la requete tombait
   * en `42703 column "tags" does not exist`, et l'utilisateur ne voyait que
   * « Erreur lors de la mise a jour des etiquettes ». Un bouton qui echoue
   * toujours vaut moins qu'un bouton absent — il fait douter du reste.
   */
  tags: text("tags").array(),
  notes: text("notes"),
  totalCalls: integer("total_calls").notNull().default(0),
  lastCallAt: timestamp("last_call_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("contacts_category_idx").on(table.category),
  index("contacts_created_at_idx").on(table.createdAt),
  index("contacts_org_id_idx").on(table.organisationId),
  // Accent-insensitive trigram search index used by the Commandant chat
  // retriever and smart search. Requires the `pg_trgm` + `unaccent` extensions
  // and the IMMUTABLE `f_unaccent()` wrapper (see lib/db/scripts/ensure-search-extensions.sql).
  index("contacts_search_trgm_idx").using(
    "gin",
    sql`f_unaccent(${table.firstName}) gin_trgm_ops`,
    sql`f_unaccent(${table.lastName}) gin_trgm_ops`,
    sql`f_unaccent(coalesce(${table.company}, '')) gin_trgm_ops`,
    sql`f_unaccent(coalesce(${table.email}, '')) gin_trgm_ops`,
    sql`f_unaccent(${table.phone}) gin_trgm_ops`,
  ),
]);

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
