import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { prospectsTable } from "./prospects";
import { devisTable } from "./devis";

export const chantiersTable = pgTable("chantiers", {
  id: serial("id").primaryKey(),
  nom: text("nom").notNull(),
  devisId: integer("devis_id").references(() => devisTable.id, { onDelete: "set null" }),
  prospectId: integer("prospect_id").references(() => prospectsTable.id, { onDelete: "set null" }),
  metier: text("metier").notNull(),
  adresse: text("adresse"),
  description: text("description"),
  dateDebut: timestamp("date_debut", { withTimezone: true }),
  dateFinPrevue: timestamp("date_fin_prevue", { withTimezone: true }),
  dateFinReelle: timestamp("date_fin_reelle", { withTimezone: true }),
  statut: text("statut").notNull().default("planifie"),
  responsable: text("responsable"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertChantierSchema = createInsertSchema(chantiersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChantier = z.infer<typeof insertChantierSchema>;
export type Chantier = typeof chantiersTable.$inferSelect;
