import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

/**
 * Etat d'un appel traite par la secretaire telephonique IA, un par CallSid.
 *
 * Il vivait dans une Map en memoire : avec plusieurs instances Cloud Run (et
 * la mise a zero), un tour d'appel tombant sur une autre instance entendait
 * « notre echange a ete interrompu » et l'appel etait perdu, rendez-vous et
 * compte rendu compris. Twilio est sans etat entre deux requetes ; l'etat doit
 * donc etre en base.
 *
 * `actions` sert de registre d'idempotence : une action (rendez-vous, rappel,
 * note, finalisation) est REVENDIQUEE par un UPDATE conditionnel sur sa cle
 * avant d'etre faite — un retry Twilio, deux instances ou un rejeu ne la
 * refont jamais. `last_request_key` / `last_response` rejouent la reponse
 * TwiML d'une requete identique (Twilio renvoie la meme requete apres un
 * delai depasse) sans rappeler le modele.
 *
 * Aucun secret ici : la configuration du fournisseur (jeton Twilio dechiffre)
 * est relue a chaque requete, jamais stockee dans l'etat.
 */
export const voiceCallSessionsTable = pgTable("voice_call_sessions", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  providerId: integer("provider_id"),
  callSid: text("call_sid").notNull(),
  /** en_cours | transfert | terminee */
  status: text("status").notNull().default("en_cours"),
  state: jsonb("state").notNull().default({}),
  actions: jsonb("actions").notNull().default({}),
  lastRequestKey: text("last_request_key"),
  lastResponse: text("last_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  /**
   * Reprise de l'appel par un humain depuis l'ecran « appel en direct ».
   * `takeover_status` est la REVENDICATION : un UPDATE conditionnel
   * (`takeover_status IS NULL`) la donne a un seul utilisateur, meme si deux
   * personnes cliquent en meme temps. en_cours = redirection Twilio en cours,
   * reussi = l'appel sonne chez l'humain ; l'IA ne produit plus aucun tour.
   * En cas d'echec Twilio, la revendication est rendue (remise a NULL).
   * FK `set null` : effacer un utilisateur (RGPD) ne bloque pas et ne
   * supprime pas l'etat de l'appel.
   */
  takenOverByUserId: integer("taken_over_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  takenOverAt: timestamp("taken_over_at", { withTimezone: true }),
  takeoverStatus: text("takeover_status"),
}, (t) => [
  uniqueIndex("voice_call_sessions_call_sid_uq").on(t.callSid),
  index("voice_call_sessions_org_idx").on(t.organisationId, t.createdAt),
  index("voice_call_sessions_status_idx").on(t.status, t.updatedAt),
]);

export type VoiceCallSession = typeof voiceCallSessionsTable.$inferSelect;
