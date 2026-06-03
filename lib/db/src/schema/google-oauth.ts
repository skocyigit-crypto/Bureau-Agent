import { pgTable, serial, text, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organisationsTable } from "./organisations";

export const googleOAuthTokensTable = pgTable("google_oauth_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  // Volontairement NULLABLE: l'isolation des tokens Google se fait par userId.
  // Un utilisateur sans organisation en session (ex. super-admin) peut connecter
  // Google; org = session ?? null cote route. La colonne reste indexee.
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  tokenType: text("token_type").notNull().default("Bearer"),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("google_oauth_user_id_idx").on(table.userId),
  index("google_oauth_org_id_idx").on(table.organisationId),
]);

// Identifiants OAuth Google PROPRES a chaque organisation (modele "bring your
// own credentials"). Chaque client (titulaire de licence) cree sa propre
// application OAuth dans Google Cloud Console et y stocke son client_id +
// client_secret. Le secret est chiffre au repos (AES-256-GCM, voir
// artifacts/api-server/src/lib/google-auth.ts). Une seule ligne par org.
export const googleAppCredentialsTable = pgTable("google_app_credentials", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("google_app_credentials_org_id_unique").on(table.organisationId),
]);
