import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organisationsTable } from "./organisations";

export const googleOAuthTokensTable = pgTable("google_oauth_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
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
