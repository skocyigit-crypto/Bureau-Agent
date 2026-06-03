import { pgTable, serial, integer, text, timestamp, numeric, boolean, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";

export const compteClientTable = pgTable("compte_client", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "cascade" }).unique(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientCompany: text("client_company"),
  totalFacture: numeric("total_facture", { precision: 12, scale: 2 }).notNull().default("0"),
  totalPaye: numeric("total_paye", { precision: 12, scale: 2 }).notNull().default("0"),
  solde: numeric("solde", { precision: 12, scale: 2 }).notNull().default("0"),
  creditLimit: numeric("credit_limit", { precision: 12, scale: 2 }).notNull().default("10000"),
  nbFactures: integer("nb_factures").notNull().default(0),
  nbFacturesPayees: integer("nb_factures_payees").notNull().default(0),
  nbFacturesEnRetard: integer("nb_factures_en_retard").notNull().default(0),
  montantEnRetard: numeric("montant_en_retard", { precision: 12, scale: 2 }).notNull().default("0"),
  aging0to30: numeric("aging_0_to_30", { precision: 12, scale: 2 }).notNull().default("0"),
  aging31to60: numeric("aging_31_to_60", { precision: 12, scale: 2 }).notNull().default("0"),
  aging61to90: numeric("aging_61_to_90", { precision: 12, scale: 2 }).notNull().default("0"),
  aging90plus: numeric("aging_90_plus", { precision: 12, scale: 2 }).notNull().default("0"),
  healthScore: integer("health_score").notNull().default(100),
  riskLevel: text("risk_level").notNull().default("faible"),
  status: text("status").notNull().default("actif"),
  delaiMoyenPaiement: integer("delai_moyen_paiement").notNull().default(0),
  paymentTermDays: integer("payment_term_days").notNull().default(30),
  lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
  lastInvoiceDate: timestamp("last_invoice_date", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  autoReminderEnabled: boolean("auto_reminder_enabled").notNull().default(true),
  notes: text("notes"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("compte_client_org_id_idx").on(table.organisationId),
  index("compte_client_contact_id_idx").on(table.contactId),
  index("compte_client_risk_idx").on(table.riskLevel),
  index("compte_client_status_idx").on(table.status),
  index("compte_client_health_idx").on(table.healthScore),
]);

export type CompteClient = typeof compteClientTable.$inferSelect;
export type InsertCompteClient = typeof compteClientTable.$inferInsert;
