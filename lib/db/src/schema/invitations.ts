import { pgTable, serial, integer, varchar, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const invitationsTable = pgTable("invitations", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 30 }).notNull().default("agent"),
  token: text("token").notNull().unique(),
  invitedBy: integer("invited_by").notNull(),
  invitedByName: varchar("invited_by_name", { length: 200 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invitations_token_idx").on(table.token),
  index("invitations_org_idx").on(table.organisationId),
  index("invitations_email_idx").on(table.email),
]);

export type Invitation = typeof invitationsTable.$inferSelect;
export type InsertInvitation = typeof invitationsTable.$inferInsert;
