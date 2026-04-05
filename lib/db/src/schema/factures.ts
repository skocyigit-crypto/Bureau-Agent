import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { prospectsTable } from "./prospects";
import { devisTable } from "./devis";

export const facturesTable = pgTable("factures", {
  id: serial("id").primaryKey(),
  numero: text("numero").notNull().unique(),
  devisId: integer("devis_id").references(() => devisTable.id, { onDelete: "set null" }),
  prospectId: integer("prospect_id").references(() => prospectsTable.id, { onDelete: "set null" }),
  type: text("type").notNull().default("acompte"),
  objet: text("objet").notNull(),
  dateEmission: timestamp("date_emission", { withTimezone: true }).notNull().defaultNow(),
  dateEcheance: timestamp("date_echeance", { withTimezone: true }),
  montantHt: numeric("montant_ht", { precision: 12, scale: 2 }).notNull().default("0"),
  tva: numeric("tva", { precision: 5, scale: 2 }).notNull().default("20"),
  montantTtc: numeric("montant_ttc", { precision: 12, scale: 2 }).notNull().default("0"),
  pourcentageAcompte: numeric("pourcentage_acompte", { precision: 5, scale: 2 }),
  montantPaye: numeric("montant_paye", { precision: 12, scale: 2 }).notNull().default("0"),
  statut: text("statut").notNull().default("en_attente"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFactureSchema = createInsertSchema(facturesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFacture = z.infer<typeof insertFactureSchema>;
export type Facture = typeof facturesTable.$inferSelect;
