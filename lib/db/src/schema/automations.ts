import { pgTable, serial, integer, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const automationRulesTable = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions"),
  actions: jsonb("actions").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  schedule: text("schedule"),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastError: text("last_error"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const automationLogsTable = pgTable("automation_logs", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull(),
  ruleName: text("rule_name").notNull(),
  status: text("status").notNull().default("success"),
  details: jsonb("details"),
  itemsProcessed: integer("items_processed").notNull().default(0),
  duration: integer("duration"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  priority: text("priority").notNull().default("normale"),
  read: boolean("read").notNull().default(false),
  actionUrl: text("action_url"),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAutomationRuleSchema = createInsertSchema(automationRulesTable).omit({ id: true, createdAt: true, updatedAt: true, runCount: true, errorCount: true });
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRulesTable.$inferSelect;
export type AutomationLog = typeof automationLogsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
