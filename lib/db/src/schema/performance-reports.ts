import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const performanceReportsTable = pgTable("performance_reports", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userEmail: text("user_email"),
  userName: text("user_name"),
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
});

export type PerformanceReport = typeof performanceReportsTable.$inferSelect;
