import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

export const aiInlineSuggestEventsTable = pgTable("ai_inline_suggest_events", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  fieldType: text("field_type").notNull(),
  event: text("event").notNull(),
  length: integer("length").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_inline_suggest_events_org_idx").on(table.organisationId),
  index("ai_inline_suggest_events_created_idx").on(table.createdAt),
  index("ai_inline_suggest_events_field_idx").on(table.fieldType),
]);

export type AiInlineSuggestEvent = typeof aiInlineSuggestEventsTable.$inferSelect;
export type AiInlineSuggestEventInsert = typeof aiInlineSuggestEventsTable.$inferInsert;
