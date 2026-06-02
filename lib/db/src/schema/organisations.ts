import { pgTable, serial, varchar, text, timestamp, boolean, integer, numeric, bigint } from "drizzle-orm/pg-core";

export const organisationsTable = pgTable("organisations", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 30 }),
  address: text("address"),
  logo: text("logo"),
  maxUsers: integer("max_users").notNull().default(5),
  actif: boolean("actif").notNull().default(true),
  bankName: varchar("bank_name", { length: 200 }),
  bankIban: varchar("bank_iban", { length: 50 }),
  bankBic: varchar("bank_bic", { length: 20 }),
  siret: varchar("siret", { length: 20 }),
  tvaNumber: varchar("tva_number", { length: 30 }),
  legalForm: varchar("legal_form", { length: 100 }),
  capital: varchar("capital", { length: 50 }),
  invoiceFooter: text("invoice_footer"),
  autoInvoiceEnabled: boolean("auto_invoice_enabled").notNull().default(true),
  autoEmailInvoice: boolean("auto_email_invoice").notNull().default(true),
  weeklySecurityEmail: boolean("weekly_security_email").notNull().default(false),
  lastSecurityDigestAt: timestamp("last_security_digest_at", { withTimezone: true }),
  proactiveEngineEnabled: boolean("proactive_engine_enabled").notNull().default(true),
  reusedScanCount: integer("reused_scan_count").notNull().default(0),
  reusedScanSavedMs: bigint("reused_scan_saved_ms", { mode: "number" }).notNull().default(0),
  aiQuotaCostUsd: numeric("ai_quota_cost_usd", { precision: 10, scale: 2 }),
  aiQuotaCalls: integer("ai_quota_calls"),
  aiAgentName: varchar("ai_agent_name", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Organisation = typeof organisationsTable.$inferSelect;
export type InsertOrganisation = typeof organisationsTable.$inferInsert;
