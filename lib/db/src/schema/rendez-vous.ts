import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { prospectsTable } from "./prospects";

export const rendezVousTable = pgTable("rendez_vous", {
  id: serial("id").primaryKey(),
  titre: text("titre").notNull(),
  description: text("description"),
  prospectId: integer("prospect_id").references(() => prospectsTable.id, { onDelete: "set null" }),
  contactNom: text("contact_nom"),
  telephone: text("telephone"),
  type: text("type").notNull().default("rdv"),
  dateDebut: timestamp("date_debut", { withTimezone: true }).notNull(),
  dateFin: timestamp("date_fin", { withTimezone: true }).notNull(),
  lieu: text("lieu"),
  statut: text("statut").notNull().default("planifie"),
  rappel: text("rappel").default("30min"),
  callId: integer("call_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRendezVousSchema = createInsertSchema(rendezVousTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRendezVous = z.infer<typeof insertRendezVousSchema>;
export type RendezVous = typeof rendezVousTable.$inferSelect;
