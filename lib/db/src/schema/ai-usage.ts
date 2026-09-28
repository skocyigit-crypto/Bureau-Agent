import { pgTable, serial, integer, text, timestamp, index, real } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

export const aiUsageTable = pgTable("ai_usage", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  route: text("route").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  status: text("status").notNull().default("success"),
  errorMessage: text("error_message"),
  /** Execution d'agent (agent_runs) qui a fait cet appel, si c'en est une. */
  runId: integer("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_usage_org_idx").on(table.organisationId),
  index("ai_usage_created_idx").on(table.createdAt),
  index("ai_usage_route_idx").on(table.route),
  index("ai_usage_run_idx").on(table.runId),
]);

export type AiUsage = typeof aiUsageTable.$inferSelect;
export type AiUsageInsert = typeof aiUsageTable.$inferInsert;
