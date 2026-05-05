import { pgTable, serial, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";
import { usersTable } from "./users";

export const dataSubjectRequestsTable = pgTable("data_subject_requests", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  requestedByUserId: integer("requested_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  requestedByName: varchar("requested_by_name", { length: 255 }),
  requestedByEmail: varchar("requested_by_email", { length: 255 }),
  requestType: varchar("request_type", { length: 50 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  details: text("details"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processedByName: varchar("processed_by_name", { length: 255 }),
  responseNotes: text("response_notes"),
  exportFilePath: varchar("export_file_path", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const DATA_REQUEST_TYPES = {
  access: {
    code: "access",
    label: "Droit d'accès (Art. 15 RGPD)",
    description: "Obtenir une copie de toutes vos données personnelles traitées",
    article: "Article 15",
    responseTime: "30 jours",
  },
  portability: {
    code: "portability",
    label: "Droit à la portabilité (Art. 20 RGPD)",
    description: "Recevoir vos données dans un format structuré et lisible par machine",
    article: "Article 20",
    responseTime: "30 jours",
  },
  rectification: {
    code: "rectification",
    label: "Droit de rectification (Art. 16 RGPD)",
    description: "Corriger vos données personnelles inexactes ou incomplètes",
    article: "Article 16",
    responseTime: "30 jours",
  },
  erasure: {
    code: "erasure",
    label: "Droit à l'effacement (Art. 17 RGPD)",
    description: "Demander la suppression de vos données personnelles",
    article: "Article 17",
    responseTime: "30 jours",
  },
  restriction: {
    code: "restriction",
    label: "Droit à la limitation (Art. 18 RGPD)",
    description: "Limiter le traitement de vos données personnelles",
    article: "Article 18",
    responseTime: "30 jours",
  },
  objection: {
    code: "objection",
    label: "Droit d'opposition (Art. 21 RGPD)",
    description: "Vous opposer au traitement de vos données pour des motifs légitimes",
    article: "Article 21",
    responseTime: "30 jours",
  },
} as const;

export type DataRequestType = keyof typeof DATA_REQUEST_TYPES;
export type DataSubjectRequest = typeof dataSubjectRequestsTable.$inferSelect;
export type InsertDataSubjectRequest = typeof dataSubjectRequestsTable.$inferInsert;
