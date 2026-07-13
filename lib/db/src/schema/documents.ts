import { pgTable, serial, integer, varchar, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
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
  scanVerdict: varchar("scan_verdict", { length: 20 }),
  scanEngine: varchar("scan_engine", { length: 50 }),
  scanDetail: text("scan_detail"),
  scanSha256: varchar("scan_sha256", { length: 64 }),
  scannedAt: timestamp("scanned_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("documents_org_id_idx").on(table.organisationId),
  index("documents_uploaded_by_idx").on(table.uploadedBy),
  index("documents_entity_idx").on(table.entityType, table.entityId),
]);
