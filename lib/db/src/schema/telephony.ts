import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const telephonyProvidersTable = pgTable("telephony_providers", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  config: jsonb("config").notNull().default({}),
  phoneNumbers: text("phone_numbers").array().notNull().default([]),
  capabilities: text("capabilities").array().notNull().default([]),
  monthlyUsage: jsonb("monthly_usage").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("telephony_providers_org_idx").on(table.organisationId),
  index("telephony_providers_provider_idx").on(table.provider),
]);

export const telephonyCallLogsTable = pgTable("telephony_call_logs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  providerId: integer("provider_id").references(() => telephonyProvidersTable.id, { onDelete: "set null" }),
  providerCallSid: text("provider_call_sid"),
  direction: text("direction").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  status: text("status").notNull(),
  duration: integer("duration").notNull().default(0),
  recordingUrl: text("recording_url"),
  transcription: text("transcription"),
  cost: text("cost"),
  currency: text("currency").default("EUR"),
  metadata: jsonb("metadata").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("telephony_logs_org_idx").on(table.organisationId),
  index("telephony_logs_provider_idx").on(table.providerId),
  index("telephony_logs_sid_idx").on(table.providerCallSid),
  index("telephony_logs_created_idx").on(table.createdAt),
]);

export const telephonySmsLogsTable = pgTable("telephony_sms_logs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  providerId: integer("provider_id").references(() => telephonyProvidersTable.id, { onDelete: "set null" }),
  providerMessageSid: text("provider_message_sid"),
  direction: text("direction").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  body: text("body"),
  status: text("status").notNull(),
  cost: text("cost"),
  currency: text("currency").default("EUR"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("telephony_sms_org_idx").on(table.organisationId),
  index("telephony_sms_provider_idx").on(table.providerId),
  index("telephony_sms_created_idx").on(table.createdAt),
]);

export type TelephonyProvider = typeof telephonyProvidersTable.$inferSelect;
export type TelephonyCallLog = typeof telephonyCallLogsTable.$inferSelect;
export type TelephonySmsLog = typeof telephonySmsLogsTable.$inferSelect;
