import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organisationsTable } from "./organisations";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  // Reste nullable INTENTIONNELLEMENT : certains evenements de securite
  // legitimes (ex. logTenantViolation dans tenant-guard.ts) journalisent un
  // userId connu mais sans organisationId de session garanti, via un fallback
  // explicite `organisationId ?? null`. Forcer NOT NULL ferait echouer ces
  // inserts silencieusement (logAudit avale ses erreurs) et perdrait
  // exactement les evenements qu'une table d'audit est censee capturer. La
  // FK ci-dessous garantit seulement qu'une valeur PRESENTE pointe vers une
  // organisation reelle (pas orpheline / supprimee).
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userEmail: text("user_email"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  resourceId: text("resource_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_org_id_idx").on(table.organisationId),
  index("audit_logs_user_id_idx").on(table.userId),
  index("audit_logs_action_idx").on(table.action),
  index("audit_logs_resource_idx").on(table.resource),
  index("audit_logs_created_at_idx").on(table.createdAt),
]);

export type AuditLog = typeof auditLogsTable.$inferSelect;
