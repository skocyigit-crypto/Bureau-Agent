import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  contactName: text("contact_name"),
  phoneNumber: text("phone_number").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull().default("note"),
  isRead: boolean("is_read").notNull().default(false),
  priority: text("priority").notNull().default("moyenne"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("messages_org_id_idx").on(table.organisationId),
  index("messages_contact_id_idx").on(table.contactId),
]);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
