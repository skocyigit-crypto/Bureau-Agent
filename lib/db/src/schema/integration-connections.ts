import { pgTable, serial, integer, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// Connexions aux intégrations du catalogue logiciel (Faz 1). Jusqu'ici, le
// endpoint POST /integrations/:id/connect VALIDAIT puis JETAIT la configuration
// (rien n'était persisté). On la persiste désormais, une ligne par
// (organisation, intégration), en séparant :
//
//  - config  : champs de configuration NON sensibles (sous-domaine, région,
//              identifiant de compte...), stockés en clair en jsonb.
//  - secrets : champs sensibles (clé API CRM, token OAuth tiers, mot de passe...),
//              chaque VALEUR étant CHIFFRÉE au repos via lib/crypto (enc:v1:).
//              On ne stocke jamais un secret d'intégration en clair.
//
// Le partage des champs sensibles vs non sensibles est dérivé du `configFields`
// du catalogue (type "password"/"secret" -> secrets, sinon config).
export const integrationConnectionsTable = pgTable("integration_connections", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  // Identifiant catalogue (ex: "salesforce", "hubspot").
  integrationId: text("integration_id").notNull(),
  integrationName: text("integration_name").notNull(),
  // en_attente | connecte | erreur | deconnecte
  status: text("status").notNull().default("en_attente"),
  // Champs de configuration NON sensibles.
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  // Champs sensibles : { [clé]: "enc:v1:..." } — valeurs chiffrées au repos.
  secrets: jsonb("secrets").$type<Record<string, string>>().notNull().default({}),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  // Une seule connexion par intégration et par organisation.
  uniqueIndex("integration_connections_org_integration_uniq").on(
    table.organisationId,
    table.integrationId,
  ),
  index("integration_connections_org_idx").on(table.organisationId),
]);

export const insertIntegrationConnectionSchema = createInsertSchema(integrationConnectionsTable).omit({
  id: true,
  connectedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertIntegrationConnection = z.infer<typeof insertIntegrationConnectionSchema>;
export type IntegrationConnection = typeof integrationConnectionsTable.$inferSelect;
