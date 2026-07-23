import { pgTable, serial, text, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Resultats des agents de sante technique.
 *
 * Distinct de `app_audit_findings` (sante des DONNEES METIER d'une
 * organisation: taches en retard, contacts inactifs...). Ici on mesure la
 * sante de l'INFRASTRUCTURE, qui est globale a la plateforme et non rattachee
 * a un locataire: saturation du pool Postgres, joignabilite reelle des
 * services externes, derive de configuration, crons morts, taux d'erreurs.
 *
 * `organisationId` est volontairement absent: une panne de base ou un Resend
 * injoignable concerne tout le monde. Les constats metier restent dans
 * app_audit_findings.
 */
export const healthChecksTable = pgTable("health_checks", {
  id: serial("id").primaryKey(),
  /** Identifiant du cycle (auto-<ISO> ou manuel-<ts>) — regroupe un passage complet. */
  runId: text("run_id").notNull(),
  /** Agent ayant produit le constat: database, dependencies, configuration, scheduler, errors, runtime. */
  agent: text("agent").notNull(),
  /** Verification unitaire au sein de l'agent (ex: "pool_saturation", "resend_reachable"). */
  check: text("check").notNull(),
  /** ok | degrade | echec | inconnu */
  status: text("status").notNull(),
  /** basse | moyenne | haute | critique — pertinent surtout quand status != ok. */
  severity: text("severity").notNull().default("basse"),
  /** Resume lisible: ce qui a ete constate. */
  summary: text("summary").notNull(),
  /** Ce qu'il faut faire concretement (vide si status = ok). */
  remediation: text("remediation").notNull().default(""),
  /** Duree de la verification, pour reperer les sondes qui trainent. */
  durationMs: integer("duration_ms").notNull().default(0),
  /** Mesures brutes (valeurs, seuils, codes HTTP) — sert au diagnostic fin. */
  metrics: jsonb("metrics").notNull().default({}),
  /** Vrai quand ce constat a deja declenche une alerte, evite de re-alerter en boucle. */
  alerted: boolean("alerted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("health_checks_run_id_idx").on(table.runId),
  index("health_checks_agent_idx").on(table.agent),
  index("health_checks_status_idx").on(table.status),
  index("health_checks_created_at_idx").on(table.createdAt),
]);

/**
 * Battement de coeur des taches planifiees.
 *
 * Sans cela, un cron qui meurt (exception non rattrapee, instance recyclee)
 * ne se signale JAMAIS: l'application parait saine alors que les relances,
 * sauvegardes ou propositions ne sont plus generees. Chaque cron met a jour sa
 * ligne a chaque passage; l'agent "scheduler" compare l'age du dernier
 * battement a l'intervalle attendu.
 */
export const cronHeartbeatsTable = pgTable("cron_heartbeats", {
  /** Nom du cron (cle stable, ex: "invoice-reminder"). */
  name: text("name").primaryKey(),
  /** Intervalle nominal en secondes — sert de reference pour juger un retard. */
  expectedIntervalSec: integer("expected_interval_sec").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }).notNull().defaultNow(),
  /** Derniere execution s'etant terminee sans exception. */
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  runCount: integer("run_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
});

export const insertHealthCheckSchema = createInsertSchema(healthChecksTable).omit({ id: true, createdAt: true });
export type InsertHealthCheck = z.infer<typeof insertHealthCheckSchema>;
export type HealthCheck = typeof healthChecksTable.$inferSelect;
export type CronHeartbeat = typeof cronHeartbeatsTable.$inferSelect;
