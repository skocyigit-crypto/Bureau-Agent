import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const assistantConversationsTable = pgTable("assistant_conversations", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull(),
  title: text("title").notNull().default("Nouvelle conversation"),
  /**
   * Profil d'agent sous lequel la conversation tourne (services/profils-agents.ts),
   * fixe a la creation. Null = assistant universel restreint. Relu a chaque
   * tour ET a chaque confirmation : changer de profil en cours de route
   * permettrait d'approuver avec un profil une action proposee sous un autre.
   */
  profilAgent: text("profil_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("assistant_conv_org_user_idx").on(t.organisationId, t.userId, t.updatedAt),
]);

export const assistantMessagesTable = pgTable("assistant_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => assistantConversationsTable.id, { onDelete: "cascade" }),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolName: text("tool_name"),
  toolArgs: jsonb("tool_args"),
  toolResult: jsonb("tool_result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("assistant_msg_conv_idx").on(t.conversationId, t.createdAt),
  index("assistant_msg_org_idx").on(t.organisationId),
]);

export type AssistantConversation = typeof assistantConversationsTable.$inferSelect;
export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;
