import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organisationsTable } from "./organisations";

export const performanceReportsTable = pgTable("performance_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userEmail: text("user_email"),
  userName: text("user_name"),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  periode: text("periode").notNull(),
  dateDebut: timestamp("date_debut", { withTimezone: true }).notNull(),
  dateFin: timestamp("date_fin", { withTimezone: true }).notNull(),
  scoreGlobal: integer("score_global"),
  metriques: jsonb("metriques"),
  analyseIA: text("analyse_ia"),
  pointsForts: jsonb("points_forts"),
  pointsAmelioration: jsonb("points_amelioration"),
  recommandations: jsonb("recommandations"),
  comparaison: jsonb("comparaison"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("perf_reports_user_id_idx").on(table.userId),
  index("perf_reports_org_id_idx").on(table.organisationId),
  index("perf_reports_periode_idx").on(table.periode),
  index("perf_reports_created_at_idx").on(table.createdAt),
]);

export type PerformanceReport = typeof performanceReportsTable.$inferSelect;
