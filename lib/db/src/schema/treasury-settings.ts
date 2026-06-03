import { pgTable, serial, integer, numeric, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

// Paramètres de trésorerie par organisation (pilier BTP — Radar de risque).
// Une seule ligne par org : les seules entrées que le système ne peut pas
// déduire des factures (le solde de caisse courant et les charges fixes
// mensuelles : URSSAF, salaires, loyer, entretien véhicules…). Sert d'entrée
// réelle à la simulation Monte Carlo de trésorerie (90 jours). Aucune donnée
// inventée : tant que cette ligne n'existe pas, le moteur ne simule pas.
export const treasurySettingsTable = pgTable("treasury_settings", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  // Solde de trésorerie courant (€) saisi par le patron.
  currentCash: numeric("current_cash", { precision: 14, scale: 2 }).notNull().default("0"),
  // Charges fixes mensuelles (€) : URSSAF, salaires, loyer, entretien…
  monthlyFixedCosts: numeric("monthly_fixed_costs", { precision: 14, scale: 2 }).notNull().default("0"),
  // Autoliquidation de TVA par défaut (BTP sous-traitance) : la trésorerie
  // encaisse le HT et non le TTC. Réglable aussi par facture.
  defaultAutoliquidation: boolean("default_autoliquidation").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Une seule ligne de paramètres par organisation.
  uniqueIndex("treasury_settings_org_uniq").on(table.organisationId),
]);

export const insertTreasurySettingsSchema = createInsertSchema(treasurySettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTreasurySettings = z.infer<typeof insertTreasurySettingsSchema>;
export type TreasurySettings = typeof treasurySettingsTable.$inferSelect;
