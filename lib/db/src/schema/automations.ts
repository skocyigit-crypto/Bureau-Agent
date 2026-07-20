import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { organisationsTable } from "./organisations";

export const automationRulesTable = pgTable("automation_rules", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions"),
  actions: jsonb("actions").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /**
   * Politique d'approbation de la regle:
   *   null  = defaut — les actions SORTANTES (send_email, send_sms) passent par
   *           la file d'approbation, les actions internes (notification, tache)
   *           restent automatiques.
   *   true  = tout passe par la file, y compris les actions internes.
   *   false = tout s'execute directement (comportement historique).
   * Une regle est ecrite une fois par un humain mais se declenche ensuite
   * seule toutes les 5 minutes: l'humain a approuve la politique, pas chaque
   * message envoye a un client.
   */
  requiresApproval: boolean("requires_approval"),
  schedule: text("schedule"),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  lastError: text("last_error"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("automation_rules_org_id_idx").on(table.organisationId),
]);

export const automationLogsTable = pgTable("automation_logs", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").references(() => automationRulesTable.id, { onDelete: "cascade" }),
  ruleName: text("rule_name").notNull(),
  status: text("status").notNull().default("success"),
  details: jsonb("details"),
  itemsProcessed: integer("items_processed").notNull().default(0),
  duration: integer("duration"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("automation_logs_rule_id_idx").on(table.ruleId),
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  priority: text("priority").notNull().default("normale"),
  read: boolean("read").notNull().default(false),
  actionUrl: text("action_url"),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_user_id_idx").on(table.userId),
  index("notifications_org_id_idx").on(table.organisationId),
  index("notifications_read_idx").on(table.read),
  index("notifications_created_at_idx").on(table.createdAt),
]);

export const insertAutomationRuleSchema = createInsertSchema(automationRulesTable).omit({ id: true, createdAt: true, updatedAt: true, runCount: true, errorCount: true });
export type InsertAutomationRule = z.infer<typeof insertAutomationRuleSchema>;
export type AutomationRule = typeof automationRulesTable.$inferSelect;
export type AutomationLog = typeof automationLogsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
