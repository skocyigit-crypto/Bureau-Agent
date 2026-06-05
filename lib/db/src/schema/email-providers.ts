import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

// Per-tenant email sending credentials (BYOK). Mirrors telephony_providers.
// The secret (Resend API key) is stored ENCRYPTED at rest inside `config`
// (see services/email-providers.ts encryptEmailConfig). When an organisation
// has an active row here, client-facing emails are sent with its own key;
// otherwise the platform key chain is used as a fallback.
export const emailProvidersTable = pgTable("email_providers", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  label: text("label").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("email_providers_org_idx").on(table.organisationId),
  index("email_providers_provider_idx").on(table.provider),
]);

export type EmailProvider = typeof emailProvidersTable.$inferSelect;
