import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { contactsTable } from "./contacts";

export const callsTable = pgTable("calls", {
  id: serial("id").primaryKey(),
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
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
