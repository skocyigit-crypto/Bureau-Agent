import { pgTable, serial, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiAgentReportsTable = pgTable("ai_agent_reports", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  agentIcon: text("agent_icon").notNull().default("brain"),
  reportDate: text("report_date").notNull(),
  status: text("status").notNull().default("en_cours"),
  score: integer("score").notNull().default(0),
  errorsFound: integer("errors_found").notNull().default(0),
  warningsFound: integer("warnings_found").notNull().default(0),
  suggestionsCount: integer("suggestions_count").notNull().default(0),
  summary: text("summary").notNull(),
  details: jsonb("details").notNull().default({}),
  errors: jsonb("errors").notNull().default([]),
  warnings: jsonb("warnings").notNull().default([]),
  suggestions: jsonb("suggestions").notNull().default([]),
  corrections: jsonb("corrections").notNull().default([]),
  isSuperReport: boolean("is_super_report").notNull().default(false),
  childReportIds: jsonb("child_report_ids").notNull().default([]),
  executionTimeMs: integer("execution_time_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAiAgentReportSchema = createInsertSchema(aiAgentReportsTable).omit({ id: true, createdAt: true });
export type InsertAiAgentReport = z.infer<typeof insertAiAgentReportSchema>;
export type AiAgentReport = typeof aiAgentReportsTable.$inferSelect;
