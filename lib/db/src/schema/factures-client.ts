import { pgTable, serial, integer, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { devisTable } from "./devis";

export const facturesClientTable = pgTable("factures_client", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  devisId: integer("devis_id").references(() => devisTable.id, { onDelete: "set null" }),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  clientAddress: text("client_address"),
  clientCompany: text("client_company"),
  items: jsonb("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    total: number;
  }[]>().default([]),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("brouillon"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  conditions: text("conditions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("factures_client_org_id_idx").on(table.organisationId),
  index("factures_client_status_idx").on(table.status),
  index("factures_client_contact_id_idx").on(table.contactId),
]);

export type FactureClient = typeof facturesClientTable.$inferSelect;
export type InsertFactureClient = typeof facturesClientTable.$inferInsert;
