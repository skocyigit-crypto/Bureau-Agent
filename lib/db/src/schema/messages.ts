import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id"),
  contactName: text("contact_name"),
  phoneNumber: text("phone_number").notNull(),
  content: text("content").notNull(),
  type: text("type").notNull().default("note"),
  isRead: boolean("is_read").notNull().default(false),
  priority: text("priority").notNull().default("moyenne"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("messages_org_id_idx").on(table.organisationId),
]);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
