import { pgTable, serial, integer, text, timestamp, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

// Clés API entrantes (Faz 1) : permettent à un développeur de l'organisation
// d'authentifier des appels programmatiques vers NOTRE API (ex: header
// Authorization: Bearer adb_live_...). Modèle de stockage à double colonne :
//
//  - keyHash  : SHA-256 de la clé complète. Sert à l'authentification (lookup
//               O(1) par hash + comparaison à temps constant). Aucune
//               vérification ne déchiffre la clé : on hash l'entrée et on
//               compare au hash stocké.
//  - keyEncrypted : la clé complète CHIFFRÉE au repos via lib/crypto (enc:v1:).
//               Existe uniquement pour la fonctionnalité « révéler » demandée
//               côté écran développeur. (Compromis assumé : conserver une copie
//               réversible est moins strict que « hash seul / affiché une fois ».
//               À confirmer ; on peut retirer keyEncrypted et n'afficher la clé
//               qu'une fois à la création si on préfère le modèle le plus strict.)
//  - keyPrefix : préfixe lisible (ex: "adb_live_a1b2c3") affiché dans l'UI pour
//               identifier la clé sans la révéler.
export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  keyEncrypted: text("key_encrypted").notNull(),
  // Portées de permission (ex: ["read", "contacts:write"]). [] = aucune.
  scopes: text("scopes").array().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  // Expiration optionnelle ; NULL = pas d'expiration.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // Révocation douce : une clé révoquée reste en base (audit) mais n'authentifie plus.
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  // Lookup d'authentification par hash : unique pour éviter les collisions.
  uniqueIndex("api_keys_key_hash_uniq").on(table.keyHash),
  index("api_keys_org_idx").on(table.organisationId),
  // Défense en profondeur : la copie réversible de la clé doit être chiffrée au
  // repos (préfixe "enc:"). NB: retirer cette contrainte ET la colonne si on
  // bascule sur le modèle « hash seul / affichée une seule fois ».
  check("api_keys_key_encrypted_chk", sql`${table.keyEncrypted} LIKE 'enc:%'`),
]);

export const insertApiKeySchema = createInsertSchema(apiKeysTable).omit({
  id: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeysTable.$inferSelect;
