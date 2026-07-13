import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

export const dailyReportsTable = pgTable("daily_reports", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  reportDate: text("report_date").notNull(),
  summary: text("summary").notNull(),
  highlights: jsonb("highlights").notNull().default([]),
  metrics: jsonb("metrics").notNull().default({}),
  aiInsights: text("ai_insights"),
  aiRecommendations: jsonb("ai_recommendations").notNull().default([]),
  callsCount: integer("calls_count").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  tasksCreated: integer("tasks_created").notNull().default(0),
  messagesCount: integer("messages_count").notNull().default(0),
  contactsAdded: integer("contacts_added").notNull().default(0),
  avgCallDuration: integer("avg_call_duration").notNull().default(0),
  answerRate: integer("answer_rate").notNull().default(0),
  score: integer("score").notNull().default(0),
  status: text("status").notNull().default("genere"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("daily_reports_org_id_idx").on(table.organisationId),
  index("daily_reports_date_idx").on(table.reportDate),
  index("daily_reports_created_at_idx").on(table.createdAt),
]);

export const insertDailyReportSchema = createInsertSchema(dailyReportsTable).omit({ id: true, createdAt: true });
export type InsertDailyReport = z.infer<typeof insertDailyReportSchema>;
export type DailyReport = typeof dailyReportsTable.$inferSelect;
