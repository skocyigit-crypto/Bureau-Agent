import { pgTable, serial, varchar, text, timestamp, boolean, integer, index, jsonb } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export interface InlineSuggestFieldFlags {
  note?: boolean;
  prospect_note?: boolean;
  email_body?: boolean;
  call_note?: boolean;
  task_description?: boolean;
  message_content?: boolean;
  project_description?: boolean;
  project_note?: boolean;
  quote_comment?: boolean;
  invoice_comment?: boolean;
}

export interface WhatsAppNotificationFlags {
  task?: boolean;        // nouvelle tache assignee
  call?: boolean;        // nouvel appel entrant
  appointment?: boolean; // nouveau rendez-vous
  message?: boolean;     // nouveau message interne
}

/**
 * Heures silencieuses : fenetre pendant laquelle les notifications push
 * sortantes (WhatsApp) sont supprimees pour cet utilisateur.
 * - start/end au format "HH:MM" (24h). Si start > end, la fenetre est de nuit
 *   (ex. 22:00 -> 07:00) et est rattachee au jour de DEBUT.
 * - days : jours (0=dimanche ... 6=samedi) ou la fenetre s'applique. Vide ou
 *   absent = tous les jours.
 * - timezone : IANA (defaut "Europe/Paris").
 */
export interface QuietHoursPrefs {
  enabled?: boolean;
  start?: string;
  end?: string;
  days?: number[];
  timezone?: string;
}

export interface UserPreferences {
  inlineSuggestEnabled?: boolean;
  inlineSuggestLanguage?: string;
  inlineSuggestFields?: InlineSuggestFieldFlags;
  whatsappNotifications?: WhatsAppNotificationFlags;
  quietHours?: QuietHoursPrefs;
}

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  nom: varchar("nom", { length: 100 }).notNull(),
  prenom: varchar("prenom", { length: 100 }).notNull(),
  role: varchar("role", { length: 30 }).notNull().default("agent"),
  departement: varchar("departement", { length: 100 }),
  organisation: varchar("organisation", { length: 200 }).default("Agent de Bureau SAS"),
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "set null" }),
  telephone: varchar("telephone", { length: 30 }),
  avatar: varchar("avatar", { length: 10 }),
  actif: boolean("actif").notNull().default(true),
  mfaActif: boolean("mfa_actif").notNull().default(false),
  mfaSecret: text("mfa_secret"),
  dernierAcces: timestamp("dernier_acces"),
  tentativesEchouees: integer("tentatives_echouees").notNull().default(0),
  verrouilleJusqua: timestamp("verrouille_jusqua"),
  resetPasswordToken: varchar("reset_password_token", { length: 128 }),
  resetPasswordExpiry: timestamp("reset_password_expiry", { withTimezone: true }),
  lastLoginFingerprint: varchar("last_login_fingerprint", { length: 64 }),
  lastLoginIp: varchar("last_login_ip", { length: 64 }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  emailVerificationToken: varchar("email_verification_token", { length: 128 }),
  emailVerificationExpiry: timestamp("email_verification_expiry", { withTimezone: true }),
  preferences: jsonb("preferences").$type<UserPreferences>(),
  // Plancher d'invalidation des Bearer tokens API stateless. Tout token
  // dont `iat` est anterieur a cette date est rejete par le middleware,
  // meme si sa signature HMAC est valide. Ecrit a chaque action sensible:
  // changement de mot de passe, reset, force-reset admin. Permet de
  // revoquer en masse les tokens long-lived (30j) qui ne sont pas dans
  // user_sessions (les Bearer sont stateless cote serveur).
  tokenInvalidatedAt: timestamp("token_invalidated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("users_organisation_id_idx").on(table.organisationId),
]);
