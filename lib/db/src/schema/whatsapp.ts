import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { usersTable } from "./users";
import { telephonyProvidersTable } from "./telephony";

export const whatsappConversationsTable = pgTable(
  "whatsapp_conversations",
  {
    id: serial("id").primaryKey(),
    organisationId: integer("organisation_id")
      .notNull()
      .references(() => organisationsTable.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").references(() => telephonyProvidersTable.id, {
      onDelete: "set null",
    }),
    contactId: integer("contact_id").references(() => contactsTable.id, {
      onDelete: "set null",
    }),
    customerPhone: text("customer_phone").notNull(),
    customerName: text("customer_name"),
    status: text("status").notNull().default("open"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text("last_message_preview"),
    lastDirection: text("last_direction"),
    draftReply: text("draft_reply"),
    draftStatus: text("draft_status").notNull().default("none"),
    draftError: text("draft_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("whatsapp_conv_org_phone_uniq").on(table.organisationId, table.customerPhone),
    index("whatsapp_conv_org_idx").on(table.organisationId),
    index("whatsapp_conv_last_msg_idx").on(table.lastMessageAt),
  ],
);

export const whatsappMessagesTable = pgTable(
  "whatsapp_messages",
  {
    id: serial("id").primaryKey(),
    organisationId: integer("organisation_id")
      .notNull()
      .references(() => organisationsTable.id, { onDelete: "cascade" }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => whatsappConversationsTable.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    body: text("body"),
    mediaUrls: text("media_urls").array().notNull().default([]),
    providerMessageSid: text("provider_message_sid"),
    status: text("status").notNull().default("received"),
    sentBy: integer("sent_by").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("whatsapp_msg_org_idx").on(table.organisationId),
    index("whatsapp_msg_conv_idx").on(table.conversationId),
    index("whatsapp_msg_created_idx").on(table.createdAt),
  ],
);

export const insertWhatsappConversationSchema = createInsertSchema(whatsappConversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertWhatsappMessageSchema = createInsertSchema(whatsappMessagesTable).omit({
  id: true,
  createdAt: true,
});

export type WhatsappConversation = typeof whatsappConversationsTable.$inferSelect;
export type WhatsappMessage = typeof whatsappMessagesTable.$inferSelect;
export type InsertWhatsappConversation = z.infer<typeof insertWhatsappConversationSchema>;
export type InsertWhatsappMessage = z.infer<typeof insertWhatsappMessageSchema>;
