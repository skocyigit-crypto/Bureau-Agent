import { pgTable, serial, integer, text, jsonb, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { webhookEndpointsTable } from "./webhook-endpoints";

// Journal des livraisons webhook (Faz 1). Chaque ligne représente une tentative
// (et ses retentatives) de livraison d'un événement vers un endpoint. Persisté
// pour : 1) la file de retry avec backoff (un worker rejoue les lignes dont
// status ∈ {pending, retrying} et nextRetryAt est échu) ; 2) l'historique
// consultable côté écran "API & Webhooks" (statut HTTP reçu, erreur, durée).
export const webhookDeliveriesTable = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  endpointId: integer("endpoint_id").notNull(),
  eventType: text("event_type").notNull(),
  // Identifiant stable de l'événement source (déduplication / idempotence).
  eventId: text("event_id"),
  // Corps JSON effectivement envoyé (signé).
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  // pending | retrying | success | failed (abandonné après maxAttempts)
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  // Code HTTP renvoyé par l'endpoint lors de la dernière tentative.
  responseStatus: integer("response_status"),
  // Réponse tronquée (debug) et message d'erreur réseau/applicatif.
  responseBody: text("response_body"),
  error: text("error"),
  // Durée de la dernière tentative (ms).
  durationMs: integer("duration_ms"),
  // Prochaine échéance de retry (backoff exponentiel). NULL si terminal.
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  // Intégrité multi-tenant : la livraison doit référencer un endpoint DE LA MÊME
  // organisation. FK composite (endpoint_id, organisation_id) -> webhook_endpoints
  // (id, organisation_id) ; empêche tout couplage cross-tenant même en cas de bug
  // applicatif, et propage la suppression (cascade) d'un endpoint à ses livraisons.
  foreignKey({
    columns: [table.endpointId, table.organisationId],
    foreignColumns: [webhookEndpointsTable.id, webhookEndpointsTable.organisationId],
    name: "webhook_deliveries_endpoint_org_fk",
  }).onDelete("cascade"),
  index("webhook_deliveries_endpoint_idx").on(table.endpointId),
  index("webhook_deliveries_org_status_idx").on(table.organisationId, table.status),
  // File de retry : le worker scanne les livraisons à rejouer par échéance.
  index("webhook_deliveries_retry_idx").on(table.status, table.nextRetryAt),
  index("webhook_deliveries_created_at_idx").on(table.createdAt),
]);

export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveriesTable).omit({
  id: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;
export type WebhookDelivery = typeof webhookDeliveriesTable.$inferSelect;
