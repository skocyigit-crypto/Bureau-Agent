import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// Job de scan antivirus groupé persisté (Tâche #141). Le store était auparavant
// un Map en mémoire par processus : un redémarrage serveur ou plusieurs
// instances API faisaient perdre la progression du lot. On persiste donc l'état
// du job (statut, compteurs, résultats, événements rejouables) afin qu'un client
// qui se reconnecte puisse reprendre la progression et que toutes les instances
// partagent le même état.
//
// Un seul job par organisation (unique sur organisationId) : un nouveau scan
// écrase le job précédent, reprenant le comportement « un slot par org » du Map.
//
// `updatedAt` sert de heartbeat : un job "running" dont le heartbeat est périmé
// (processus mort en plein scan) est réconcilié en "interrupted" par le endpoint
// de statut.
export const bulkScanJobsTable = pgTable("bulk_scan_jobs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  // running | completed | failed | cancelled | interrupted
  status: text("status").notNull().default("running"),
  // Jeton d'appartenance (UUID par exécution). L'instance qui acquiert le slot
  // l'écrit ; ses écritures de progression/heartbeat sont conditionnées à ce
  // jeton pour qu'une autre instance ayant repris un job orphelin ne soit pas
  // écrasée, et pour que le worker détecte qu'il a perdu la main.
  runnerId: text("runner_id"),
  startedByUserId: integer("started_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  requested: integer("requested").notNull().default(0),
  total: integer("total").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  safe: integer("safe").notNull().default(0),
  dangerous: integer("dangerous").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  results: jsonb("results").$type<unknown[]>().notNull().default([]),
  events: jsonb("events").$type<unknown[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Heartbeat : touché à chaque progression et par un timer périodique pendant
  // le scan. Permet de détecter les jobs orphelins après un crash/redémarrage.
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("bulk_scan_jobs_org_uniq").on(table.organisationId),
  index("bulk_scan_jobs_status_idx").on(table.status),
]);

export const insertBulkScanJobSchema = createInsertSchema(bulkScanJobsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBulkScanJob = z.infer<typeof insertBulkScanJobSchema>;
export type BulkScanJob = typeof bulkScanJobsTable.$inferSelect;
