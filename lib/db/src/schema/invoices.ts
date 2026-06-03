import { pgTable, serial, integer, varchar, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const OVERAGE_RATES = {
  extraUserPerMonth: 10,
  extraContactsPer100: 2,
  extraCallsPer100: 3,
} as const;

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  periodLabel: varchar("period_label", { length: 20 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  plan: varchar("plan", { length: 50 }).notNull(),
  baseAmount: numeric("base_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  overageAmount: numeric("overage_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  status: varchar("status", { length: 20 }).notNull().default("en_attente"),
  usageSnapshot: jsonb("usage_snapshot").$type<{
    users: { current: number; max: number; overage: number };
    contacts: { current: number; max: number; overage: number };
    calls: { current: number; max: number; overage: number };
    overageDetails: {
      extraUsers: number;
      extraUsersAmount: number;
      extraContacts: number;
      extraContactsAmount: number;
      extraCalls: number;
      extraCallsAmount: number;
    };
  }>(),
  notes: text("notes"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("invoices_org_id_idx").on(table.organisationId),
  index("invoices_status_idx").on(table.status),
]);

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  // Volontairement NULLABLE: les releves bancaires (source "bank_upload") sont
  // importes AVANT d'etre rapproches d'une facture; tant qu'un paiement n'est pas
  // reconcilie, il n'est rattache a aucune organisation. L'org est renseignee au
  // moment du matching (voir /billing/upload-bank + reconciliation).
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  source: varchar("source", { length: 30 }).notNull().default("bank_upload"),
  bankRef: varchar("bank_ref", { length: 200 }),
  bankDate: timestamp("bank_date", { withTimezone: true }),
  payerName: varchar("payer_name", { length: 200 }),
  payerIban: varchar("payer_iban", { length: 50 }),
  matchedBy: varchar("matched_by", { length: 20 }).default("manual"),
  matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  rawLine: text("raw_line"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("payments_org_id_idx").on(table.organisationId),
  index("payments_invoice_idx").on(table.invoiceId),
]);

export type Invoice = typeof invoicesTable.$inferSelect;
export type InsertInvoice = typeof invoicesTable.$inferInsert;
export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
