import { pgTable, serial, integer, varchar, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull(),
  uploadedBy: integer("uploaded_by"),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  originalName: varchar("original_name", { length: 500 }).notNull(),
  mimeType: varchar("mime_type", { length: 200 }).notNull(),
  fileSize: integer("file_size").notNull(),
  fileContent: text("file_content"),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: integer("entity_id"),
  category: varchar("category", { length: 50 }).default("general"),
  description: text("description"),
  tags: jsonb("tags").$type<string[]>().default([]),
  aiAnalysis: jsonb("ai_analysis").$type<Record<string, any>>(),
  aiProcessed: boolean("ai_processed").default(false),
  extractedText: text("extracted_text"),
  extractedData: jsonb("extracted_data").$type<Record<string, any>>(),
  status: varchar("status", { length: 30 }).default("uploaded"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
