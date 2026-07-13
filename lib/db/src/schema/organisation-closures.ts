import { pgTable, serial, integer, varchar, timestamp } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const organisationClosuresTable = pgTable("organisation_closures", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  dateStart: varchar("date_start", { length: 10 }).notNull(),
  dateEnd: varchar("date_end", { length: 10 }).notNull(),
  label: varchar("label", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrganisationClosure = typeof organisationClosuresTable.$inferSelect;
export type InsertOrganisationClosure = typeof organisationClosuresTable.$inferInsert;
