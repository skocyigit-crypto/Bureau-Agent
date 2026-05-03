import { pgTable, serial, integer, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const objectifsCommerciauxTable = pgTable("objectifs_commerciaux", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  metric: text("metric").notNull().default("revenue"),
  targetValue: numeric("target_value", { precision: 15, scale: 2 }).notNull().default("0"),
  currentValue: numeric("current_value", { precision: 15, scale: 2 }).notNull().default("0"),
  period: text("period").notNull().default("monthly"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  status: text("status").notNull().default("actif"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("objectifs_commerciaux_org_id_idx").on(table.organisationId),
]);

export type ObjectifCommercial = typeof objectifsCommerciauxTable.$inferSelect;
export type InsertObjectifCommercial = typeof objectifsCommerciauxTable.$inferInsert;
