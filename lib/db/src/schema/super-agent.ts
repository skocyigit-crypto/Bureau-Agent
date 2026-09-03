import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

/**
 * Etat du Super Agent, partage entre les instances.
 *
 * Le service API tourne avec `maxScale=3` et l'etat vivait dans une `Map` de
 * module — donc une copie par processus, perdue a chaque redeploiement. Deux
 * consequences, toutes deux visibles par le client:
 *
 *  - `POST /ai/super-agent/run` part sur une instance, `GET /ai/super-agent/status`
 *    peut atterrir sur une autre: l'utilisateur lance un cycle puis regarde un
 *    ecran qui dit qu'il ne s'est jamais rien passe (aucun journal, compteurs a
 *    zero). Le travail a bien eu lieu; c'est le compte rendu qui manquait;
 *  - le garde-fou `running` ne gardait qu'un seul processus. Trois instances
 *    pouvaient executer le meme cycle en parallele sur la meme organisation.
 *
 * Les compteurs sont des colonnes entieres et non un objet JSON: ils sont
 * incrementes en SQL (`+ excluded`), ce qui evite qu'un cycle ecrase les
 * compteurs d'un autre en relisant puis reecrivant l'objet entier.
 */
export const superAgentStateTable = pgTable("super_agent_state", {
  /** Une ligne par organisation: l'etat est celui du locataire, pas du processus. */
  organisationId: integer("organisation_id")
    .primaryKey()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  running: boolean("running").notNull().default(false),
  /**
   * Debut du cycle en cours. Sans lui, une instance tuee en plein cycle
   * laisserait `running = true` pour toujours et l'organisation ne pourrait
   * plus jamais lancer de cycle: la reprise se fait sur l'age de ce champ.
   */
  runningSince: timestamp("running_since", { withTimezone: true }),
  lastRun: timestamp("last_run", { withTimezone: true }),
  tasksCreated: integer("tasks_created").notNull().default(0),
  tasksFixed: integer("tasks_fixed").notNull().default(0),
  emailsProcessed: integer("emails_processed").notNull().default(0),
  reportsProcessed: integer("reports_processed").notNull().default(0),
  fixesApplied: integer("fixes_applied").notNull().default(0),
  cyclesRun: integer("cycles_run").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Journal du Super Agent — une ligne par evenement, jamais un tableau JSON
 * reecrit en entier: deux instances qui ajoutent une ligne en meme temps ne
 * doivent pas s'effacer mutuellement.
 */
export const superAgentLogsTable = pgTable("super_agent_logs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  /** info | success | warning | error */
  level: text("level").notNull(),
  /** email | chantier | system | tache | appel */
  source: text("source").notNull(),
  message: text("message").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // La consultation ne lit que les dernieres lignes d'une organisation, et
  // l'elagage supprime les plus anciennes de cette meme organisation.
  index("super_agent_logs_org_id_idx").on(table.organisationId, table.id),
]);

export type SuperAgentStateRow = typeof superAgentStateTable.$inferSelect;
export type SuperAgentLogRow = typeof superAgentLogsTable.$inferSelect;
