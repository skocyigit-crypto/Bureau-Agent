import { pgTable, serial, integer, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

// Per-tenant AI provider credentials (BYOK). Mirrors email_providers /
// telephony_providers. The secret (provider API key) is stored ENCRYPTED at
// rest inside `config` (see services/ai-providers.ts encryptAiConfig). When an
// organisation has an active row for a provider, that provider's calls use its
// own key (direct API, no Replit AI proxy); otherwise the platform key chain
// is used as a fallback.
export const aiProvidersTable = pgTable("ai_providers", {
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
  index("ai_providers_org_idx").on(table.organisationId),
  index("ai_providers_provider_idx").on(table.provider),
]);

export type AiProvider = typeof aiProvidersTable.$inferSelect;
