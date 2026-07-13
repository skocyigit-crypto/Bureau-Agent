import { pgTable, serial, integer, text, timestamp, jsonb, varchar, index } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const faceProfilesTable = pgTable("face_profiles", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id"),
  userId: integer("user_id"),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 100 }).default("contact"),
  photoUrl: text("photo_url"),
  faceDescriptor: jsonb("face_descriptor"),
  metadata: jsonb("metadata"),
  lastSeenAt: timestamp("last_seen_at"),
  recognitionCount: integer("recognition_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("face_profiles_org_id_idx").on(table.organisationId),
]);

export const faceRecognitionLogsTable = pgTable("face_recognition_logs", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  faceProfileId: integer("face_profile_id").references(() => faceProfilesTable.id, { onDelete: "set null" }),
  recognizedName: varchar("recognized_name", { length: 255 }),
  confidence: integer("confidence"),
  action: varchar("action", { length: 100 }),
  location: text("location"),
  deviceInfo: text("device_info"),
  aiAnalysis: text("ai_analysis"),
  photoBase64: text("photo_base64"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("face_recognition_logs_org_id_idx").on(table.organisationId),
  index("face_recognition_logs_profile_idx").on(table.faceProfileId),
]);
