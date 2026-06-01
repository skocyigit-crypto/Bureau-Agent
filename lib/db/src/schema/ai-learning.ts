import { pgTable, serial, integer, text, real, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

// Couche d'apprentissage IA (pilier B).
//
// Deux tables org-scope, alimentées par des agrégations DÉTERMINISTES (aucun
// coût IA): elles transforment le feedback (👍/👎 des suggestions proactives +
// votes des insights) et les signaux récurrents (appelants, horaires, thèmes de
// tâches) en "mémoire" réutilisable. Un bloc de contexte borné est ensuite
// injecté (fail-soft) dans les prompts IA pour personnaliser les réponses.

// Préférences apprises = agrégation du feedback par (kind, key).
// kind: "suggestion_type" (depuis proactive_suggestions.type + feedback)
//     | "insight_category" (depuis ai_insights.category + vote)
export const aiLearnedPreferencesTable = pgTable("ai_learned_preferences", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  upCount: integer("up_count").notNull().default(0),
  downCount: integer("down_count").notNull().default(0),
  // Score normalisé dans [-1, 1] = (up - down) / (up + down).
  score: real("score").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_learned_pref_org_kind_key_uniq").on(
    table.organisationId,
    table.kind,
    table.key,
  ),
]);

// Motifs récurrents minés sur les signaux existants (calls, tasks).
// patternType: "frequent_caller" | "busy_hour" | "task_theme"
export const aiRecurringPatternsTable = pgTable("ai_recurring_patterns", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  patternType: text("pattern_type").notNull(),
  // Étiquette lisible (ex: "Jean Dupont", "9 h", "Rappel client").
  label: text("label").notNull(),
  // Valeur canonique pour la déduplication (ex: "+33...", "9", "rappel").
  value: text("value").notNull(),
  occurrences: integer("occurrences").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_recurring_pattern_org_type_value_uniq").on(
    table.organisationId,
    table.patternType,
    table.value,
  ),
  index("ai_recurring_pattern_org_type_idx").on(table.organisationId, table.patternType),
]);

export type AiLearnedPreference = typeof aiLearnedPreferencesTable.$inferSelect;
export type AiRecurringPattern = typeof aiRecurringPatternsTable.$inferSelect;
