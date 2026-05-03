import { pgTable, serial, integer, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const commandesFournisseurTable = pgTable("commandes_fournisseur", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  reference: text("reference").notNull(),
  fournisseurName: text("fournisseur_name").notNull(),
  fournisseurEmail: text("fournisseur_email"),
  fournisseurPhone: text("fournisseur_phone"),
  fournisseurAddress: text("fournisseur_address"),
  items: jsonb("items").$type<{
    description: string;
    reference: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    total: number;
  }[]>().default([]),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("brouillon"),
  expectedDelivery: timestamp("expected_delivery", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  notes: text("notes"),
  conditions: text("conditions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("commandes_fournisseur_org_id_idx").on(table.organisationId),
  index("commandes_fournisseur_status_idx").on(table.status),
]);

export type CommandeFournisseur = typeof commandesFournisseurTable.$inferSelect;
export type InsertCommandeFournisseur = typeof commandesFournisseurTable.$inferInsert;
