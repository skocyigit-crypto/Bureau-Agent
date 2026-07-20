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
  // Capture automatique des dépenses : tout justificatif entrant (upload ou
  // pièce jointe e-mail) reconnu comme facture/note de frais est analysé par
  // Document IA puis poussé dans la file d'inspection des dépenses. Voir
  // services/expense-capture.ts.
  expenseAutoCaptureEnabled: boolean("expense_auto_capture_enabled").notNull().default(true),
  // Réglages par org du moteur proactif (réglables depuis l'UI). Défauts =
  // valeurs historiques codées en dur (8 h / 21 j). Voir proactive-engine.ts.
  messageSlaHours: integer("message_sla_hours").notNull().default(8),
  quietCustomerAfterDays: integer("quiet_customer_after_days").notNull().default(21),
  // Relances de paiement automatiques (services/invoice-reminder-cron.ts).
  // Ces e-mails partent vers les CLIENTS de l'organisation: elle doit pouvoir
  // les couper entierement (avant: aucun moyen de le faire, le cron passait
  // sur toutes les organisations sans condition).
  autoRemindersEnabled: boolean("auto_reminders_enabled").notNull().default(true),
  // Quand true (defaut), les relances de paiement et les factures mensuelles
  // generees automatiquement passent par la file d'approbation au lieu d'etre
  // envoyees/finalisees directement. Ce sont des actions visibles par le
  // client final et difficiles a rattraper: un humain doit les voir d'abord.
  billingRequiresApproval: boolean("billing_requires_approval").notNull().default(true),
  agentAutoRunEnabled: boolean("agent_auto_run_enabled").notNull().default(false),
  agentAutoRunLastRunAt: timestamp("agent_auto_run_last_run_at", { withTimezone: true }),
  // Horaires d'ouverture utilises par le service de disponibilites (creneaux
  // de rendez-vous). Jours = numeros ISO (1=lundi .. 7=dimanche) separes par
  // des virgules. Heures = "HH:MM" 24h. Fuseau IANA. Duree par defaut d'un RDV.
  workingDays: varchar("working_days", { length: 20 }).notNull().default("1,2,3,4,5"),
  workingHoursStart: varchar("working_hours_start", { length: 5 }).notNull().default("09:00"),
  workingHoursEnd: varchar("working_hours_end", { length: 5 }).notNull().default("18:00"),
  appointmentTimezone: varchar("appointment_timezone", { length: 60 }).notNull().default("Europe/Paris"),
  appointmentDurationMinutes: integer("appointment_duration_minutes").notNull().default(30),
  aiLearningLastRunAt: timestamp("ai_learning_last_run_at", { withTimezone: true }),
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
