import { pgTable, serial, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const platformConnectionsTable = pgTable("platform_connections", {
  id: serial("id").primaryKey(),
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
});

export const platformSyncLogsTable = pgTable("platform_sync_logs", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  serviceId: text("service_id").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  details: text("details"),
  itemsProcessed: text("items_processed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
