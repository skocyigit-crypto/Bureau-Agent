import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone").notNull(),
  mobile: text("mobile"),
  category: text("category").notNull().default("autre"),
  address: text("address"),
  notes: text("notes"),
  totalCalls: integer("total_calls").notNull().default(0),
  lastCallAt: timestamp("last_call_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("contacts_category_idx").on(table.category),
  index("contacts_created_at_idx").on(table.createdAt),
  index("contacts_org_id_idx").on(table.organisationId),
]);

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
