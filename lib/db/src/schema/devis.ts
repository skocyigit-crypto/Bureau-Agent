import { pgTable, serial, integer, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { prospectsTable } from "./prospects";

export const devisTable = pgTable("devis", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  prospectId: integer("prospect_id").references(() => prospectsTable.id, { onDelete: "set null" }),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  description: text("description"),
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
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("brouillon"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  convertedToInvoice: integer("converted_to_invoice"),
  notes: text("notes"),
  conditions: text("conditions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("devis_org_id_idx").on(table.organisationId),
  index("devis_status_idx").on(table.status),
  index("devis_contact_id_idx").on(table.contactId),
]);

export type Devis = typeof devisTable.$inferSelect;
export type InsertDevis = typeof devisTable.$inferInsert;
