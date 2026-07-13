import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const autoBackupsTable = pgTable("auto_backups", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("snapshot"),
  status: text("status").notNull().default("en_cours"),
  platform: text("platform").notNull().default("local"),
  dataSummary: jsonb("data_summary"),
  sizeBytes: integer("size_bytes"),
  encryptionHash: text("encryption_hash"),
  duration: integer("duration_ms"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupConfigTable = pgTable("backup_config", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(),
  enabled: text("enabled").notNull().default("true"),
  intervalMinutes: integer("interval_minutes").notNull().default(2),
  retentionDays: integer("retention_days").notNull().default(90),
  encryptionEnabled: text("encryption_enabled").notNull().default("true"),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  storagePath: text("storage_path"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
