import { pgTable, serial, integer, varchar, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { invoicesTable } from "./invoices";
import { facturesClientTable } from "./factures-client";

export const paymentRemindersTable = pgTable("payment_reminders", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  factureClientId: integer("facture_client_id").references(() => facturesClientTable.id, { onDelete: "set null" }),
  type: varchar("type", { length: 30 }).notNull().default("payment_due"),
  recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
  recipientName: varchar("recipient_name", { length: 255 }),
  subject: text("subject").notNull(),
  content: text("content"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  reminderLevel: integer("reminder_level").notNull().default(1),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("payment_reminders_org_id_idx").on(table.organisationId),
  index("payment_reminders_status_idx").on(table.status),
]);

export const licenseAuditLogTable = pgTable("license_audit_log", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 100 }).notNull(),
  details: text("details"),
  performedBy: integer("performed_by"),
  ipAddress: varchar("ip_address", { length: 50 }),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("license_audit_log_org_id_idx").on(table.organisationId),
]);

export type PaymentReminder = typeof paymentRemindersTable.$inferSelect;
export type LicenseAuditLog = typeof licenseAuditLogTable.$inferSelect;
