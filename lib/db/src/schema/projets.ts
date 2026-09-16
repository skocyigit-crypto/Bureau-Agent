import { pgTable, serial, integer, text, timestamp, numeric, jsonb, index, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";

export const projetsTable = pgTable("projets", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("planifie"),
  priority: text("priority").notNull().default("moyenne"),
  clientName: text("client_name"),
  clientCompany: text("client_company"),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  budget: numeric("budget", { precision: 12, scale: 2 }),
  spent: numeric("spent", { precision: 12, scale: 2 }).default("0"),
  currency: text("currency").notNull().default("EUR"),
  progress: integer("progress").notNull().default(0),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  actualEndDate: timestamp("actual_end_date", { withTimezone: true }),

  // --- Reception des travaux ----------------------------------------------
  //
  // `actualEndDate` dit quand le chantier s'est arrete. La RECEPTION est autre
  // chose: un acte juridique, constate par un proces-verbal, qui transfere la
  // garde de l'ouvrage et fait partir TOUTES les garanties legales — parfait
  // achevement (1 an), bon fonctionnement (2 ans), decennale (10 ans) — ainsi
  // que le delai de restitution de la retenue de garantie (12 mois).
  //
  // Sans cette date, aucune de ces echeances n'est calculable. Avant cette
  // colonne, le vocabulaire du chantier n'existait dans tout le depot que
  // sous forme de chaine dans la fixture d'un test d'extraction PDF.
  receptionDate: timestamp("reception_date", { withTimezone: true }),

  // Une reception PEUT etre prononcee avec reserves, et elle fait quand meme
  // partir la decennale. Les reserves sont couvertes par la garantie de
  // parfait achevement, c'est-a-dire un regime et un delai differents: les
  // confondre avec un refus de reception est l'erreur classique.
  receptionWithReserves: boolean("reception_with_reserves").notNull().default(false),
  receptionReserves: text("reception_reserves"),

  // Date de levee des reserves. Elle ne deplace AUCUNE des garanties: leur
  // point de depart reste la reception.
  reservesLiftedAt: timestamp("reserves_lifted_at", { withTimezone: true }),
  assignedTo: text("assigned_to"),
  teamMembers: text("team_members").array(),
  milestones: jsonb("milestones").$type<{
    title: string;
    dueDate: string;
    completed: boolean;
  }[]>().default([]),
  tags: text("tags").array(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("projets_org_id_idx").on(table.organisationId),
  index("projets_status_idx").on(table.status),
  index("projets_contact_id_idx").on(table.contactId),
  // Accent-insensitive trigram search index used by the Commandant chat
  // (find_project) and smart search. Requires `pg_trgm` + `unaccent` and the
  // IMMUTABLE `f_unaccent()` wrapper (see lib/db/scripts/ensure-search-extensions.sql).
  index("projets_search_trgm_idx").using(
    "gin",
    sql`f_unaccent(${table.title}) gin_trgm_ops`,
    sql`f_unaccent(coalesce(${table.description}, '')) gin_trgm_ops`,
  ),
]);

export type Projet = typeof projetsTable.$inferSelect;
export type InsertProjet = typeof projetsTable.$inferInsert;
