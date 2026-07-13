import { pgTable, serial, integer, text, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";

export const prospectsTable = pgTable("prospects", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  contactName: text("contact_name"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  stage: text("stage").notNull().default("nouveau"),
  priority: text("priority").notNull().default("moyenne"),
  value: numeric("value", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("EUR"),
  probability: integer("probability").default(50),
  source: text("source"),
  assignedTo: text("assigned_to"),
  expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
  wonAt: timestamp("won_at", { withTimezone: true }),
  lostAt: timestamp("lost_at", { withTimezone: true }),
  lostReason: text("lost_reason"),
  notes: text("notes"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("prospects_org_id_idx").on(table.organisationId),
  index("prospects_stage_idx").on(table.stage),
  index("prospects_contact_id_idx").on(table.contactId),
  // Accent-insensitive trigram search index used by the Commandant chat
  // retriever and smart search. Requires `pg_trgm` + `unaccent` and the
  // IMMUTABLE `f_unaccent()` wrapper (see lib/db/scripts/ensure-search-extensions.sql).
  index("prospects_search_trgm_idx").using(
    "gin",
    sql`f_unaccent(coalesce(${table.company}, '')) gin_trgm_ops`,
    sql`f_unaccent(coalesce(${table.contactName}, '')) gin_trgm_ops`,
    sql`f_unaccent(coalesce(${table.email}, '')) gin_trgm_ops`,
  ),
]);

export type Prospect = typeof prospectsTable.$inferSelect;
export type InsertProspect = typeof prospectsTable.$inferInsert;
