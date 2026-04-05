import { pgTable, serial, integer, text, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { prospectsTable } from "./prospects";

export const devisTable = pgTable("devis", {
  id: serial("id").primaryKey(),
  numero: text("numero").notNull().unique(),
  prospectId: integer("prospect_id").references(() => prospectsTable.id, { onDelete: "cascade" }).notNull(),
  objet: text("objet").notNull(),
  description: text("description"),
  dateCreation: timestamp("date_creation", { withTimezone: true }).notNull().defaultNow(),
  dateValidite: timestamp("date_validite", { withTimezone: true }),
  statut: text("statut").notNull().default("brouillon"),
  montantHt: numeric("montant_ht", { precision: 12, scale: 2 }).notNull().default("0"),
  tva: numeric("tva", { precision: 5, scale: 2 }).notNull().default("20"),
  montantTtc: numeric("montant_ttc", { precision: 12, scale: 2 }).notNull().default("0"),
  conditions: text("conditions"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const devisLignesTable = pgTable("devis_lignes", {
  id: serial("id").primaryKey(),
  devisId: integer("devis_id").references(() => devisTable.id, { onDelete: "cascade" }).notNull(),
  description: text("description").notNull(),
  metier: text("metier"),
  quantite: numeric("quantite", { precision: 10, scale: 2 }).notNull().default("1"),
  unite: text("unite").notNull().default("unite"),
  prixUnitaire: numeric("prix_unitaire", { precision: 10, scale: 2 }).notNull().default("0"),
  montantHt: numeric("montant_ht", { precision: 12, scale: 2 }).notNull().default("0"),
  ordre: integer("ordre").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDevisSchema = createInsertSchema(devisTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDevis = z.infer<typeof insertDevisSchema>;
export type Devis = typeof devisTable.$inferSelect;

export const insertDevisLigneSchema = createInsertSchema(devisLignesTable).omit({ id: true, createdAt: true });
export type InsertDevisLigne = z.infer<typeof insertDevisLigneSchema>;
export type DevisLigne = typeof devisLignesTable.$inferSelect;
