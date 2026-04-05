import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { chantiersTable } from "./chantiers";

export const situationsTable = pgTable("situations", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  numero: integer("numero").notNull().default(1),
  type: text("type").notNull().default("general"),
  description: text("description"),
  pourcentage: numeric("pourcentage", { precision: 5, scale: 2 }).notNull().default("0"),
  montantHt: numeric("montant_ht", { precision: 12, scale: 2 }).notNull().default("0"),
  montantTtc: numeric("montant_ttc", { precision: 12, scale: 2 }).notNull().default("0"),
  statut: text("statut").notNull().default("en_cours"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const chantierNotesTable = pgTable("chantier_notes", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  contenu: text("contenu").notNull(),
  auteur: text("auteur"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chantierCommandesTable = pgTable("chantier_commandes", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  reference: text("reference").notNull(),
  fournisseur: text("fournisseur").notNull(),
  description: text("description"),
  montant: numeric("montant", { precision: 12, scale: 2 }).notNull().default("0"),
  statut: text("statut").notNull().default("en_attente"),
  dateLivraison: timestamp("date_livraison", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chantierSousTraitanceTable = pgTable("chantier_sous_traitance", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  entreprise: text("entreprise").notNull(),
  metier: text("metier").notNull(),
  contact: text("contact"),
  telephone: text("telephone"),
  montant: numeric("montant", { precision: 12, scale: 2 }).notNull().default("0"),
  statut: text("statut").notNull().default("en_attente"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chantierPlanningTable = pgTable("chantier_planning", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  titre: text("titre").notNull(),
  metier: text("metier"),
  dateDebut: timestamp("date_debut", { withTimezone: true }).notNull(),
  dateFin: timestamp("date_fin", { withTimezone: true }).notNull(),
  responsable: text("responsable"),
  statut: text("statut").notNull().default("planifie"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chantierTachesTable = pgTable("chantier_taches", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  titre: text("titre").notNull(),
  description: text("description"),
  assigneA: text("assigne_a"),
  priorite: text("priorite").notNull().default("moyenne"),
  statut: text("statut").notNull().default("a_faire"),
  dateEcheance: timestamp("date_echeance", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const chantierMailsTable = pgTable("chantier_mails", {
  id: serial("id").primaryKey(),
  chantierId: integer("chantier_id").references(() => chantiersTable.id, { onDelete: "cascade" }).notNull(),
  destinataire: text("destinataire").notNull(),
  objet: text("objet").notNull(),
  contenu: text("contenu").notNull(),
  statut: text("statut").notNull().default("envoye"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSituationSchema = createInsertSchema(situationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSituation = z.infer<typeof insertSituationSchema>;
export type Situation = typeof situationsTable.$inferSelect;
