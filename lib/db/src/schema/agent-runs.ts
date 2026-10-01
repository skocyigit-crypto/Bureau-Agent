import { pgTable, serial, text, timestamp, integer, jsonb, real, index, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

/**
 * Journal d'execution des agents : une ligne par EXECUTION d'un agent du
 * catalogue (services/catalogue-agents.ts), et ses etapes.
 *
 * Avant ces tables, un agent laissait au mieux un rapport final
 * (`ai_agent_reports`) et des lignes d'usage sans lien entre elles
 * (`ai_usage`) : impossible de dire ce qui tourne, ce qui attend un humain, ce
 * qui a echoue et pourquoi, ni ce qu'une execution a coute. L'ecran « Bureau
 * des taches » lit `agent_runs` par statut ; le detail d'une execution lit ses
 * etapes.
 *
 * Une devolution (le classificateur confie la demande a l'agent support)
 * cree une execution ENFANT (`parent_run_id`) : chaque agent a ses propres
 * etapes, ses propres couts, et son propre verdict.
 */
export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Identifiant de l'agent dans le catalogue (ex. « classificateur »). */
  agentId: text("agent_id").notNull(),
  /** Execution qui a confie celle-ci (devolution), sinon null. */
  parentRunId: integer("parent_run_id"),
  /** Ce qui a lance l'execution : demande_manuelle, email, whatsapp... */
  trigger: text("trigger").notNull(),
  /** en_cours | en_attente (d'une approbation) | terminee | echouee */
  status: text("status").notNull().default("en_cours"),
  /** Resume de l'entree — jamais le contenu brut complet (minimisation). */
  input: jsonb("input").notNull().default({}),
  output: jsonb("output"),
  /** Cause d'echec lisible, affichee telle quelle au client. */
  error: text("error"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  requestedBy: integer("requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("agent_runs_org_started_idx").on(t.organisationId, t.startedAt),
  index("agent_runs_org_status_idx").on(t.organisationId, t.status),
  index("agent_runs_parent_idx").on(t.parentRunId),
]);

/**
 * Etapes d'une execution, dans l'ordre : appel au modele, decision, outil,
 * mise en approbation, devolution. C'est ce que montre le detail d'une
 * execution (« Suivi et couts ») : ce qui s'est passe, combien de temps, a
 * quel prix, et pourquoi cela a echoue.
 */
export const agentRunStepsTable = pgTable("agent_run_steps", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => agentRunsTable.id, { onDelete: "cascade" }),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Rang dans l'execution, a partir de 1. */
  position: integer("position").notNull(),
  /** llm | decision | outil | approbation | devolution */
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  /** ok | echec | en_attente | refuse */
  status: text("status").notNull(),
  detail: jsonb("detail").notNull().default({}),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_run_steps_run_idx").on(t.runId, t.position),
  index("agent_run_steps_org_idx").on(t.organisationId),
]);

/**
 * Etat d'un profil d'agent metier (services/profils-agents.ts) POUR UNE
 * organisation : essaye, publie, desactive.
 *
 * Pourquoi une table et pas un drapeau dans `organisations` : chaque profil a
 * son propre cycle (essai a blanc -> publication par un responsable ->
 * desactivation), et la publication doit pouvoir citer l'essai qui l'a
 * precedee. `last_dry_run_id` pointe vers ce run d'essai ; la route de
 * publication verifie qu'il appartient a la MEME organisation.
 *
 * Absence de ligne = profil ACTIF (services/profils-org.ts) : un client
 * existant ne perd rien au deploiement. Une ligne n'existe que si un
 * responsable a desactive/publie le profil ou qu'un essai valide a ete note ;
 * chaque ecriture fixe `enabled` explicitement (le defaut SQL n'est jamais lu).
 */
export const agentProfileSettingsTable = pgTable("agent_profile_settings", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Identifiant du profil (telephone, crm, planning, chantier, finance, coordinateur). */
  agentId: text("agent_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: integer("published_by").references(() => usersTable.id, { onDelete: "set null" }),
  lastDryRunId: integer("last_dry_run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("agent_profile_settings_org_agent_uniq").on(t.organisationId, t.agentId),
]);

export type AgentProfileSettings = typeof agentProfileSettingsTable.$inferSelect;
export type AgentRun = typeof agentRunsTable.$inferSelect;
export type AgentRunStep = typeof agentRunStepsTable.$inferSelect;
