import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";
import { organisationsTable } from "./organisations";

export const callsTable = pgTable("calls", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  contactName: text("contact_name"),
  phoneNumber: text("phone_number").notNull(),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  duration: integer("duration").notNull().default(0),
  notes: text("notes"),
  sentiment: text("sentiment"),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("calls_contact_id_idx").on(table.contactId),
  index("calls_status_idx").on(table.status),
  index("calls_created_at_idx").on(table.createdAt),
  index("calls_org_id_idx").on(table.organisationId),
]);

export const insertCallSchema = createInsertSchema(callsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
