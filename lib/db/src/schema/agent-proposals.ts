import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

/**
 * File d'attente d'approbation de l'agent autonome ("Onay Kuyruğu").
 *
 * L'agent de bureau autonome tourne en arrière-plan, analyse l'activité
 * (tâches en retard, appels manqués, messages non lus, rendez-vous à venir)
 * et PROPOSE des actions concrètes — il ne les exécute jamais tout seul.
 * Chaque proposition atterrit ici avec le statut `en_attente`. Le patron
 * valide ou rejette depuis un seul écran ; à l'approbation, l'action est
 * exécutée via les outils de l'assistant (executeTool, skipConfirmation).
 */
export const agentProposalsTable = pgTable("agent_proposals", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Identifiant du cycle de génération (auto-AAAA-MM-JJ ou manuel-<ts>). */
  runId: text("run_id").notNull(),
  /** Nom de l'outil assistant à exécuter (create_task, send_email, ...). */
  toolName: text("tool_name").notNull(),
  /** Titre court lisible par l'humain. */
  title: text("title").notNull(),
  /** Description de ce que l'action fera concrètement. */
  summary: text("summary").notNull(),
  /** Pourquoi l'agent propose cette action (contexte déclencheur). */
  reason: text("reason").notNull().default(""),
  /** Arguments passés à l'outil au moment de l'exécution. */
  args: jsonb("args").notNull().default({}),
  /** Catégorie d'affichage: tache, email, sms, rappel, relance, contact. */
  category: text("category").notNull().default("autre"),
  priority: text("priority").notNull().default("moyenne"),
  /** Confiance de l'agent 0–100. */
  confidence: integer("confidence").notNull().default(0),
  /** Type de source déclencheuse (task_overdue, missed_call, ...). */
  sourceType: text("source_type").notNull().default(""),
  /** Clé de déduplication (évite de re-proposer la même action). */
  sourceRef: text("source_ref").notNull().default(""),
  /** en_attente | approuvee | rejetee | executee | echouee | expiree */
  status: text("status").notNull().default("en_attente"),
  /** Résultat de l'exécution (succès/erreur). */
  result: jsonb("result").notNull().default({}),
  decidedBy: integer("decided_by"),
  /** Note libre du dirigeant au moment de la décision (motif de rejet surtout). */
  decisionNote: text("decision_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("agent_proposals_org_id_idx").on(table.organisationId),
  index("agent_proposals_status_idx").on(table.status),
  index("agent_proposals_run_id_idx").on(table.runId),
  index("agent_proposals_source_ref_idx").on(table.sourceRef),
  index("agent_proposals_created_at_idx").on(table.createdAt),
]);

export const insertAgentProposalSchema = createInsertSchema(agentProposalsTable).omit({ id: true, createdAt: true });
export type InsertAgentProposal = z.infer<typeof insertAgentProposalSchema>;
export type AgentProposal = typeof agentProposalsTable.$inferSelect;
