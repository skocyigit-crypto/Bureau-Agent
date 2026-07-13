import { pgTable, text, timestamp, integer, varchar, index } from "drizzle-orm/pg-core";

// Idempotence DB-backed du webhook WhatsApp entrant (Twilio). Remplace le cache
// in-memory: en multi-instance, un MessageSid rejoué par Twilio doit être
// dédoublonné quelle que soit l'instance qui reçoit le rejeu.
//
// Machine à états identique au webhook Stripe (stripe_webhook_events): une ligne
// est d'abord écrite en "processing" (revendication), puis basculée en
// "processed" UNIQUEMENT après traitement réussi. La déduplication n'ignore que
// les lignes "processed" — une ligne restée en "processing" signifie qu'une
// tentative précédente a échoué avant la fin, donc un rejeu Twilio DOIT pouvoir
// la retraiter (les effets de bord sont idempotents / fail-soft). Marquer
// "processed" d'emblée perdrait définitivement le message sur une panne
// transitoire.
export const whatsappProcessedMessagesTable = pgTable(
  "whatsapp_processed_messages",
  {
    messageSid: text("message_sid").primaryKey(),
    organisationId: integer("organisation_id"),
    status: varchar("status", { length: 20 }).notNull().default("processing"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Purge périodique des vieilles lignes par date.
    index("whatsapp_processed_msg_at_idx").on(table.processedAt),
  ],
);

export type WhatsappProcessedMessage = typeof whatsappProcessedMessagesTable.$inferSelect;
