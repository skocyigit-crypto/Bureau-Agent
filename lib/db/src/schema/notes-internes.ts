import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const notesInternesTable = pgTable("notes_internes", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id"),
  title: text("title"),
  content: text("content").notNull(),
  color: text("color").notNull().default("default"),
  pinned: boolean("pinned").notNull().default(false),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("notes_internes_org_id_idx").on(table.organisationId),
]);

export type NoteInterne = typeof notesInternesTable.$inferSelect;
export type InsertNoteInterne = typeof notesInternesTable.$inferInsert;
