import { pgTable, serial, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const adminReportsTable = pgTable("admin_reports", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull(),
  userId: integer("user_id").notNull(),
  userName: varchar("user_name", { length: 200 }),
  userEmail: varchar("user_email", { length: 255 }),
  orgName: varchar("org_name", { length: 200 }),
  subject: varchar("subject", { length: 300 }).notNull(),
  category: varchar("category", { length: 50 }).notNull().default("general"),
  message: text("message").notNull(),
  priority: varchar("priority", { length: 20 }).notNull().default("normal"),
  status: varchar("status", { length: 30 }).notNull().default("nouveau"),
  adminResponse: text("admin_response"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AdminReport = typeof adminReportsTable.$inferSelect;
export type InsertAdminReport = typeof adminReportsTable.$inferInsert;
