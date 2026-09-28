import { pgTable, serial, integer, varchar, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * « Ce travail a ete fait pour cette entite sur cette periode » — une ligne,
 * posee AVANT de faire le travail, par un INSERT qui ne reussit qu'une fois.
 *
 * Mesure du 28/09 : plusieurs taches periodiques (audit de l'application,
 * insights IA) n'avaient pour marqueur « deja fait aujourd'hui » que leurs
 * propres resultats, ou une variable du processus. Un passage sans resultat
 * ne laissait aucune trace : chaque instance Cloud Run (jusqu'a trois), a
 * chaque demarrage et chaque heure, repayait l'appel au modele ; deux
 * instances pouvaient aussi travailler la meme organisation en meme temps.
 *
 * L'index unique (job, entite, periode) tranche cote Postgres : une seule
 * instance obtient la periode. Aucune donnee d'organisation ici (seulement un
 * identifiant et une periode) ; purge a 60 jours.
 */
export const cronExecutionsTable = pgTable("cron_executions", {
  id: serial("id").primaryKey(),
  job: varchar("job", { length: 60 }).notNull(),
  entityId: integer("entity_id").notNull(),
  periode: varchar("periode", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cron_executions_job_entite_periode_uq").on(t.job, t.entityId, t.periode),
  index("cron_executions_created_at_idx").on(t.createdAt),
]);
