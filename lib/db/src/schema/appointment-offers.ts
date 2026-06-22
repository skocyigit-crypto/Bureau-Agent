import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { calendarEventsTable } from "./calendar-events";
import { usersTable } from "./users";

/**
 * Offres de rendez-vous ("propose-confirm").
 *
 * L'agent / la secretaire propose 2-3 creneaux LIBRES (calcules par le service
 * de disponibilites) a un client. L'envoi du message (email/SMS) passe par la
 * file d'approbation (agent_proposals) — aucune communication externe autonome.
 * Le client choisit un creneau via un lien public porteur d'un `token`. A la
 * selection, on revalide que le creneau est toujours libre, on ecrit
 * l'evenement dans l'agenda (status `confirme`) et on envoie une confirmation.
 */
export const appointmentOffersTable = pgTable("appointment_offers", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  relatedContactId: integer("related_contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  /** Motif du rendez-vous (titre de l'evenement cree a la confirmation). */
  reason: text("reason").notNull().default("Rendez-vous"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  /** Creneaux proposes: [{ start: ISO, end: ISO }]. */
  slots: jsonb("slots").notNull().default([]).$type<Array<{ start: string; end: string }>>(),
  /** Canal d'envoi de l'offre: email | sms. */
  channel: text("channel").notNull().default("email"),
  /** Jeton public (non devinable) servant a ouvrir/choisir l'offre. */
  token: text("token").notNull().unique(),
  /** envoye | confirme | expire | annule */
  status: text("status").notNull().default("envoye"),
  selectedSlotIndex: integer("selected_slot_index"),
  selectedStart: timestamp("selected_start", { withTimezone: true }),
  selectedEnd: timestamp("selected_end", { withTimezone: true }),
  calendarEventId: integer("calendar_event_id").references(() => calendarEventsTable.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** Horodatage du rappel pre-rendez-vous envoye au client. NULL = pas encore envoye. */
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("appointment_offers_org_id_idx").on(table.organisationId),
  index("appointment_offers_status_idx").on(table.status),
  index("appointment_offers_token_idx").on(table.token),
  index("appointment_offers_contact_idx").on(table.relatedContactId),
  index("appointment_offers_created_at_idx").on(table.createdAt),
]);

export const insertAppointmentOfferSchema = createInsertSchema(appointmentOffersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAppointmentOffer = z.infer<typeof insertAppointmentOfferSchema>;
export type AppointmentOffer = typeof appointmentOffersTable.$inferSelect;
