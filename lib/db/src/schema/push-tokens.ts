import { pgTable, serial, text, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

/**
 * Jetons de notification push (Expo) enregistres par l'application mobile.
 *
 * Pourquoi: jusqu'ici l'app ne produisait que des notifications LOCALES,
 * declenchees par son propre flux SSE — donc uniquement tant que le JS
 * tournait. Application fermee (cas normal sur iOS des que l'OS suspend le
 * process), aucune alerte n'arrivait: nouveau message, tache urgente ou appel
 * manque restaient invisibles jusqu'a la prochaine ouverture manuelle.
 *
 * Un utilisateur peut avoir plusieurs appareils; un meme appareil reinstalle
 * emet un nouveau jeton. La contrainte d'unicite porte donc sur le jeton lui
 * meme (un jeton = un appareil), et le rattachement utilisateur/organisation
 * est reecrit a chaque enregistrement — c'est ce qui evite qu'un appareil
 * revendu ou repris par un collegue continue de recevoir les notifications du
 * compte precedent.
 */
export const pushTokensTable = pgTable("push_tokens", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  /** Jeton Expo (`ExponentPushToken[...]`). */
  token: text("token").notNull(),
  /** "ios" | "android" — purement informatif (diagnostic / statistiques). */
  platform: text("platform"),
  /** Derniere erreur renvoyee par Expo pour ce jeton (diagnostic). */
  lastError: text("last_error"),
  /** Derniere fois que l'app a confirme ce jeton (menage des jetons morts). */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("push_tokens_token_key").on(table.token),
  index("push_tokens_org_id_idx").on(table.organisationId),
  index("push_tokens_user_id_idx").on(table.userId),
]);

export const insertPushTokenSchema = createInsertSchema(pushTokensTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSeenAt: true,
  lastError: true,
});
export type InsertPushToken = z.infer<typeof insertPushTokenSchema>;
export type PushToken = typeof pushTokensTable.$inferSelect;
