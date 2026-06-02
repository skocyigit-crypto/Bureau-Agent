import { pgTable, serial, text, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

/**
 * Bulgues de l'agent d'auto-audit ("Oto-Denetim Ajanı").
 *
 * L'agent d'auto-audit tourne en arrière-plan, inspecte l'état de
 * l'application (santé, qualité des données, sécurité, usage, fonctionnalités)
 * et produit deux types de constats :
 *   - `eksik`   : une lacune / un risque concret à corriger.
 *   - `yenilik` : une idée d'amélioration ou d'innovation.
 *
 * Chaque constat est enregistré ici (rapport visible par le patron). Lorsqu'un
 * constat est *actionnable* via un outil de l'assistant, l'agent crée aussi une
 * proposition dans la file d'approbation (agent_proposals) et la relie via
 * `linkedProposalId`. L'agent ne modifie JAMAIS les données client tout seul :
 * tout passe par l'approbation du patron.
 */
export const appAuditFindingsTable = pgTable("app_audit_findings", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** Identifiant du cycle de génération (auto-AAAA-MM-JJ ou manuel-<ts>). */
  runId: text("run_id").notNull(),
  /** eksik (lacune/risque) | yenilik (amélioration/innovation) */
  kind: text("kind").notNull().default("eksik"),
  /** Domaine: sante, donnees, securite, usage, fonctionnalite, general. */
  area: text("area").notNull().default("general"),
  /** basse | moyenne | haute | critique */
  severity: text("severity").notNull().default("moyenne"),
  /** Titre court lisible. */
  title: text("title").notNull(),
  /** Constat détaillé (ce qui a été observé). */
  detail: text("detail").notNull().default(""),
  /** Recommandation concrète (ce qu'il faudrait faire). */
  suggestion: text("suggestion").notNull().default(""),
  /** Le constat peut-il être traité via une action de l'assistant ? */
  actionable: boolean("actionable").notNull().default(false),
  /** Proposition liée dans la file d'approbation (si actionable). */
  linkedProposalId: integer("linked_proposal_id"),
  /** Clé de déduplication (évite de re-signaler le même constat). */
  sourceRef: text("source_ref").notNull().default(""),
  /** nouveau | vu | archive */
  status: text("status").notNull().default("nouveau"),
  /** Métriques brutes ayant déclenché le constat. */
  metric: jsonb("metric").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("app_audit_findings_org_id_idx").on(table.organisationId),
  index("app_audit_findings_status_idx").on(table.status),
  index("app_audit_findings_kind_idx").on(table.kind),
  index("app_audit_findings_source_ref_idx").on(table.sourceRef),
  index("app_audit_findings_created_at_idx").on(table.createdAt),
]);

export const insertAppAuditFindingSchema = createInsertSchema(appAuditFindingsTable).omit({ id: true, createdAt: true });
export type InsertAppAuditFinding = z.infer<typeof insertAppAuditFindingSchema>;
export type AppAuditFinding = typeof appAuditFindingsTable.$inferSelect;
