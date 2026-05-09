import { pgTable, serial, integer, text, timestamp, boolean, smallint, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const aiInsightsTable = pgTable("ai_insights", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id"),
  category: text("category").notNull().default("general"),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  actionUrl: text("action_url"),
  actionLabel: text("action_label"),
  vote: smallint("vote").notNull().default(0),
  dismissed: boolean("dismissed").notNull().default(false),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  index("ai_insights_org_dismissed_idx").on(table.organisationId, table.dismissed, table.generatedAt),
  index("ai_insights_expires_idx").on(table.expiresAt),
]);

export type AiInsight = typeof aiInsightsTable.$inferSelect;
export type InsertAiInsight = typeof aiInsightsTable.$inferInsert;
