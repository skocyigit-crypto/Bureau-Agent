import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// Suggestions proactives générées par le moteur d'autonomie (pilier A).
// Chaque ligne est une action recommandée, déduplicée par (organisationId,
// dedupeKey) tant qu'elle est "pending". Le champ `feedback` (👍/👎) alimentera
// la couche d'apprentissage IA (pilier B).
export const proactiveSuggestionsTable = pgTable("proactive_suggestions", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  // overdue_task | missed_call_followup | calendar_conflict | ...
  type: text("type").notNull(),
  // info | warning | urgent
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  detail: text("detail"),
  // pending | accepted | dismissed | done
  status: text("status").notNull().default("pending"),
  // task | call | calendar | contact | message
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: integer("related_entity_id"),
  // open_task | callback | reschedule | open_calendar | create_task | ...
  actionType: text("action_type"),
  actionPayload: jsonb("action_payload").$type<Record<string, unknown>>(),
  // Clé de déduplication stable (ex: "overdue_task:42").
  dedupeKey: text("dedupe_key").notNull(),
  // up | down (null = pas encore noté) — alimente le pilier B.
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
}, (table) => [
  index("proactive_sugg_org_status_idx").on(table.organisationId, table.status),
  index("proactive_sugg_org_dedupe_idx").on(table.organisationId, table.dedupeKey),
  index("proactive_sugg_created_at_idx").on(table.createdAt),
  // Garantie de déduplication au niveau base: une seule suggestion "pending"
  // par (org, dedupeKey). Empêche les doublons en cas d'exécutions concurrentes
  // (cron + /proactive/run manuel, ou plusieurs instances). L'insert utilise
  // ON CONFLICT DO NOTHING pour rester idempotent.
  uniqueIndex("proactive_sugg_pending_dedupe_uniq")
    .on(table.organisationId, table.dedupeKey)
    .where(sql`${table.status} = 'pending'`),
]);

export const insertProactiveSuggestionSchema = createInsertSchema(proactiveSuggestionsTable).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
  resolvedByUserId: true,
});
export type InsertProactiveSuggestion = z.infer<typeof insertProactiveSuggestionSchema>;
export type ProactiveSuggestion = typeof proactiveSuggestionsTable.$inferSelect;
