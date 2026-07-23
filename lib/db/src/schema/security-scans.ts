import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";

/**
 * Journal des analyses de securite (URL, fichier, appel, e-mail, WhatsApp).
 *
 * Ces verdicts etaient conserves uniquement en memoire (Map, 500 par
 * organisation). Cloud Run arrete l'instance des que le trafic cesse: le
 * journal disparaissait donc regulierement, et deux instances simultanees
 * n'avaient pas le meme historique — alors que l'interface le presente comme
 * un historique de securite consultable. Un journal qui s'efface tout seul
 * n'est pas un journal.
 */
export const securityScansTable = pgTable("security_scans", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id"),
  /** url | file | whatsapp | call | email */
  kind: text("kind").notNull(),
  /** Element analyse (URL, nom de fichier, numero...). Tronque a l'insertion. */
  target: text("target").notNull(),
  /** safe | suspicious | dangerous */
  verdict: text("verdict").notNull(),
  details: text("details").notNull().default(""),
  /** Moteur ayant produit le verdict (Heuristique, VirusTotal, Safe Browsing...). */
  engine: text("engine"),
  /** Origine d'un verdict externe: lookup d'empreinte ou soumission a chaud. */
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("security_scans_org_id_idx").on(table.organisationId),
  index("security_scans_created_at_idx").on(table.createdAt),
  index("security_scans_verdict_idx").on(table.verdict),
]);

export const insertSecurityScanSchema = createInsertSchema(securityScansTable).omit({ id: true, createdAt: true });
export type InsertSecurityScan = z.infer<typeof insertSecurityScanSchema>;
export type SecurityScan = typeof securityScansTable.$inferSelect;
