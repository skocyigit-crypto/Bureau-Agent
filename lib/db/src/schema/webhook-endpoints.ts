import { pgTable, serial, integer, text, boolean, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// Endpoints webhook sortants génériques (Faz 1). Une organisation peut
// enregistrer une ou plusieurs URLs externes qui recevront, en HTTP POST signé
// (HMAC SHA-256), les événements métier émis par l'application (création de
// contact, tâche terminée, appel manqué...). Chaque endpoint possède son propre
// secret de signature, CHIFFRÉ AU REPOS via lib/crypto (préfixe "enc:v1:") :
// il n'est jamais stocké en clair et n'est révélé qu'une seule fois à la
// création / rotation côté API.
export const webhookEndpointsTable = pgTable("webhook_endpoints", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  description: text("description"),
  // Types d'événements souscrits (ex: ["contact.created", "task.completed"]).
  // "*" = tous les événements.
  events: text("events").array().notNull().default([]),
  // Secret de signature HMAC, CHIFFRÉ au repos (enc:v1:). Jamais exposé en lecture.
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  // Compteur d'échecs consécutifs : sert à désactiver automatiquement un
  // endpoint durablement injoignable (circuit breaker).
  failureCount: integer("failure_count").notNull().default(0),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  // Dernier état observé : success | failed (résumé lisible côté UI).
  lastStatus: text("last_status"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("webhook_endpoints_org_idx").on(table.organisationId),
  index("webhook_endpoints_active_idx").on(table.active),
  // Cible de la FK composite des livraisons (id, organisation_id) : garantit
  // qu'une livraison ne peut référencer qu'un endpoint de SA propre organisation.
  // Contrainte UNIQUE (et non simple index) : Postgres exige une vraie contrainte
  // unique comme cible de clé étrangère composite.
  unique("webhook_endpoints_id_org_uniq").on(table.id, table.organisationId),
  // Défense en profondeur : le secret de signature doit être chiffré au repos
  // (préfixe "enc:") — empêche toute persistance accidentelle en clair.
  check("webhook_endpoints_secret_encrypted_chk", sql`${table.secret} LIKE 'enc:%'`),
]);

export const insertWebhookEndpointSchema = createInsertSchema(webhookEndpointsTable).omit({
  id: true,
  failureCount: true,
  lastDeliveryAt: true,
  lastStatus: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWebhookEndpoint = z.infer<typeof insertWebhookEndpointSchema>;
export type WebhookEndpoint = typeof webhookEndpointsTable.$inferSelect;
