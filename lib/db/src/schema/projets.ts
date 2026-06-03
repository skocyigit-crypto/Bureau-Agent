import { pgTable, serial, integer, text, timestamp, numeric, jsonb, index, doublePrecision } from "drizzle-orm/pg-core";
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
  // Regime TVA du chantier (BTP) : "autoliquidation" (sous-traitance),
  // "20", "10", "5.5". Sert au calcul tresorerie + aux factures liees.
  tvaStatus: text("tva_status").notNull().default("autoliquidation"),
  progress: integer("progress").notNull().default(0),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  actualEndDate: timestamp("actual_end_date", { withTimezone: true }),
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
]);

export type Projet = typeof projetsTable.$inferSelect;
export type InsertProjet = typeof projetsTable.$inferInsert;
