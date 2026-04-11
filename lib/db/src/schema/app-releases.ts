import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const appReleasesTable = pgTable("app_releases", {
  id: serial("id").primaryKey(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  changes: text("changes"),
  type: text("type").notNull().default("update"),
  isActive: boolean("is_active").notNull().default(true),
  forceUpdate: boolean("force_update").notNull().default(false),
  buildHash: text("build_hash"),
  publishedBy: integer("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppRelease = typeof appReleasesTable.$inferSelect;
export type InsertAppRelease = typeof appReleasesTable.$inferInsert;
