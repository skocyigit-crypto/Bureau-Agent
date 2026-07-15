import { pgTable, serial, integer, text, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const platformConnectionsTable = pgTable("platform_connections", {
  id: serial("id").primaryKey(),
  // Nullable (pas de backfill possible pour les lignes existantes) : une
  // connexion sans organisation n'est plus jamais lue/ecrite par aucune route
  // (toutes scopees par organisationId depuis ce correctif) — un statut
  // "connecte" pour une organisation ne peut plus etre lu/modifie par une
  // autre. Avant ce correctif, cette table etait partagee par TOUTES les
  // organisations de la plateforme (aucune colonne d'organisation).
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  serviceId: text("service_id").notNull(),
  serviceName: text("service_name").notNull(),
  status: text("status").notNull().default("deconnecte"),
  lastSync: timestamp("last_sync", { withTimezone: true }),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  syncEnabled: boolean("sync_enabled").notNull().default(true),
  syncInterval: text("sync_interval").notNull().default("15min"),
  config: jsonb("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("platform_org_service_unique_idx").on(table.organisationId, table.platform, table.serviceId),
  index("platform_connections_org_id_idx").on(table.organisationId),
]);

export const platformSyncLogsTable = pgTable("platform_sync_logs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  serviceId: text("service_id").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  details: text("details"),
  itemsProcessed: text("items_processed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("platform_sync_logs_org_id_idx").on(table.organisationId),
]);
