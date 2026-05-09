import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

export const commandantConversationsTable = pgTable("commandant_conversations", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Nouvelle conversation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("commandant_conv_org_user_idx").on(t.organisationId, t.userId, t.updatedAt),
]);

export const commandantMessagesTable = pgTable("commandant_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => commandantConversationsTable.id, { onDelete: "cascade" }),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("commandant_msg_conv_idx").on(t.conversationId, t.createdAt),
]);

export type CommandantConversation = typeof commandantConversationsTable.$inferSelect;
export type CommandantMessage = typeof commandantMessagesTable.$inferSelect;
