import { pgTable, serial, text, timestamp, integer, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

export const checkinsTable = pgTable("checkins", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  employeeName: text("employee_name").notNull(),
  employeeRole: text("employee_role"),
  type: text("type").notNull(),
  status: text("status").notNull(),
  // `location` est DECLARE par le telephone: une chaine libre que le serveur
  // recopiait sans rien verifier. Un pointage a des consequences de paie; le
  // croire sur parole revenait a laisser n'importe qui poster « Chantier
  // Haguenau » depuis chez lui, avec un simple appel a l'API.
  location: text("location"),
  /**
   * Le serveur a-t-il pu CONSTATER la presence sur une zone, par lui-meme ?
   *
   * Le constat ne vient pas du corps de la requete mais de l'etat de position
   * que le serveur tient a jour depuis les relevés du mobile
   * (`user_location_state`). Trois valeurs, parce que « faux » melangerait deux
   * situations tres differentes:
   *   - `verifie`   : releve recent, a l'interieur d'une zone de l'organisation;
   *   - `hors_zone` : releve recent, mais hors de toute zone;
   *   - `inconnu`   : aucun releve exploitable — suivi desactive, application
   *                   fermee, hors des horaires de travail. Ce n'est PAS une
   *                   fraude, et l'afficher comme telle serait accuser a tort.
   */
  locationCheck: varchar("location_check", { length: 12 }).notNull().default("inconnu"),
  /** Zone effectivement constatee, quand il y en a une. */
  geofenceId: integer("geofence_id"),
  notes: text("notes"),
  ipAddress: text("ip_address"),
  checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
  checkOutAt: timestamp("check_out_at", { withTimezone: true }),
  breakMinutes: integer("break_minutes").notNull().default(0),
  totalMinutes: integer("total_minutes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("checkins_org_id_idx").on(table.organisationId),
]);

export const insertCheckinSchema = createInsertSchema(checkinsTable).omit({ id: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true });
export type InsertCheckin = z.infer<typeof insertCheckinSchema>;
export type Checkin = typeof checkinsTable.$inferSelect;
