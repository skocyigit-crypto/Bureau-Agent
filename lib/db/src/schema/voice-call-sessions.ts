import { pgTable, serial, integer, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

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
}, (t) => [
  uniqueIndex("voice_call_sessions_call_sid_uq").on(t.callSid),
  index("voice_call_sessions_org_idx").on(t.organisationId, t.createdAt),
  index("voice_call_sessions_status_idx").on(t.status, t.updatedAt),
]);

export type VoiceCallSession = typeof voiceCallSessionsTable.$inferSelect;
