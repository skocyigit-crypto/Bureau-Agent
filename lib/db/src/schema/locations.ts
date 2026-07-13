// Wave 3 — Suivi des employes dans leur zone (geofence + 7/24).
// 3 tables :
//   * geofences            : zones definies par le patron (ofis, chantier, ...)
//   * user_location_state  : derniere position connue de chaque employe (1 ligne par user)
//   * location_events      : journal d'entree/sortie + pings bruts (retention 30 jours)
//
// Toutes les tables sont scopees par organisation_id (multi-tenant strict).

import { pgTable, serial, text, integer, boolean, timestamp, doublePrecision, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// ---------------------------------------------------------------------------
// geofences : zone circulaire (centre + rayon en metres) attachee a l'org.
// On garde isActive plutot qu'un hard delete pour conserver l'historique
// d'evenements lies a une zone supprimee.
// ---------------------------------------------------------------------------
export const geofencesTable = pgTable("geofences", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  radiusM: integer("radius_m").notNull().default(100),
  color: text("color").notNull().default("#3b82f6"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("geofences_org_id_idx").on(t.organisationId),
  index("geofences_org_active_idx").on(t.organisationId, t.isActive),
]);

export const insertGeofenceSchema = createInsertSchema(geofencesTable).omit({
  id: true, createdAt: true, updatedAt: true, createdBy: true, organisationId: true,
});
export type InsertGeofence = z.infer<typeof insertGeofenceSchema>;
export type Geofence = typeof geofencesTable.$inferSelect;

// ---------------------------------------------------------------------------
// user_location_state : 1 ligne par employe. Mise a jour a chaque ping mobile.
// `currentGeofenceIds` est un tableau jsonb d'ids — utilise pour diff
// enter/exit a la prochaine reception. unique(userId) pour garantir le upsert.
// ---------------------------------------------------------------------------
export const userLocationStateTable = pgTable("user_location_state", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastAccuracyM: doublePrecision("last_accuracy_m"),
  lastAt: timestamp("last_at", { withTimezone: true }),
  currentGeofenceIds: jsonb("current_geofence_ids").$type<number[]>().notNull().default([]),
  battery: integer("battery"),
  isMoving: boolean("is_moving").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("user_location_state_user_uniq").on(t.userId),
  index("user_location_state_org_idx").on(t.organisationId),
]);

export type UserLocationState = typeof userLocationStateTable.$inferSelect;

// ---------------------------------------------------------------------------
// location_events : journal append-only.
//   event = "enter" | "exit" | "ping"
//   geofenceId = id de la zone concernee (NULL pour les pings bruts hors zone)
// Index sur (orgId, at) pour les requetes admin "historique 30 jours".
// La retention (30j) est appliquee par un job ou un endpoint d'entretien
// — pas par un trigger DB pour rester portable hors Postgres-extensions.
// ---------------------------------------------------------------------------
export const locationEventsTable = pgTable("location_events", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  geofenceId: integer("geofence_id").references(() => geofencesTable.id, { onDelete: "set null" }),
  event: text("event").notNull(), // "enter" | "exit" | "ping"
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracyM: doublePrecision("accuracy_m"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("location_events_org_at_idx").on(t.organisationId, t.at),
  index("location_events_user_at_idx").on(t.userId, t.at),
  index("location_events_geofence_idx").on(t.geofenceId),
]);

export type LocationEvent = typeof locationEventsTable.$inferSelect;
