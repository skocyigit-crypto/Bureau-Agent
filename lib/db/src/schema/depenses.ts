import { pgTable, serial, integer, text, timestamp, numeric, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./organisations";
import { documentsTable } from "./documents";
import { usersTable } from "./users";

// Registre des dépenses (« gider defteri ») — couche client. Chaque ligne est
// une dépense issue d'un justificatif (fiche/facture fournisseur) capté
// automatiquement par Document IA (upload ou pièce jointe e-mail) puis revu et
// approuvé par un humain avant d'entrer au registre. Aucune écriture
// comptable officielle ni paiement automatique : c'est un livre de dépenses
// interne qui alimente le radar de trésorerie (sorties de caisse).
//
// Cycle de vie via `status` :
//   en_attente -> file d'attente d'inspection (champs préremplis par l'IA)
//   approuve   -> enregistré au registre + visible en trésorerie
//   rejete     -> écarté (faux positif, doublon non voulu, etc.)
export const EXPENSE_STATUSES = ["en_attente", "approuve", "rejete"] as const;
export const EXPENSE_PAYMENT_STATUSES = ["a_payer", "paye"] as const;
export const EXPENSE_SOURCES = ["upload", "gmail", "manuel"] as const;
// Catégories de dépense (français). « autre » par défaut tant qu'aucun
// mot-clé ne correspond. L'utilisateur peut corriger en file d'inspection.
export const EXPENSE_CATEGORIES = [
  "carburant",
  "fournitures",
  "materiel",
  "sous_traitance",
  "loyer",
  "assurance",
  "telephone_internet",
  "repas",
  "deplacement",
  "entretien_vehicule",
  "honoraires",
  "taxes",
  "autre",
] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export type ExpensePaymentStatus = (typeof EXPENSE_PAYMENT_STATUSES)[number];
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const depensesTable = pgTable("depenses", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  // Justificatif source (NULL si saisie manuelle ou document supprimé).
  documentId: integer("document_id").references(() => documentsTable.id, { onDelete: "set null" }),
  // Fournisseur / émetteur du justificatif.
  vendor: text("vendor").notNull().default(""),
  title: text("title"),
  // Numéro de facture / référence du justificatif.
  reference: text("reference"),
  category: text("category").notNull().default("autre"),
  // Date du justificatif (date de la dépense). NULL si illisible.
  expenseDate: timestamp("expense_date", { withTimezone: true }),
  // Échéance de paiement éventuelle (alimente la simulation de trésorerie).
  dueDate: timestamp("due_date", { withTimezone: true }),
  amountHt: numeric("amount_ht", { precision: 12, scale: 2 }).notNull().default("0"),
  amountTva: numeric("amount_tva", { precision: 12, scale: 2 }).notNull().default("0"),
  amountTtc: numeric("amount_ttc", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("en_attente"),
  paymentStatus: text("payment_status").notNull().default("a_payer"),
  source: text("source").notNull().default("upload"),
  // Champs bruts extraits par l'IA (audit / réouverture).
  extractedFields: jsonb("extracted_fields").$type<Record<string, unknown>>(),
  aiConfidence: numeric("ai_confidence", { precision: 4, scale: 3 }),
  notes: text("notes"),
  // Empreinte de déduplication : normalize(vendor)|amountTtc|YYYY-MM-DD.
  dedupeHash: text("dedupe_hash"),
  // Si renseigné, cette dépense est un doublon présumé d'une autre (même
  // fournisseur + montant + date). On NE bloque PAS : on alerte l'humain.
  duplicateOfId: integer("duplicate_of_id"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("depenses_org_status_idx").on(table.organisationId, table.status),
  index("depenses_org_dedupe_idx").on(table.organisationId, table.dedupeHash),
  index("depenses_org_date_idx").on(table.organisationId, table.expenseDate),
  index("depenses_org_category_idx").on(table.organisationId, table.category),
  index("depenses_document_idx").on(table.documentId),
]);

export const insertDepenseSchema = createInsertSchema(depensesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDepense = z.infer<typeof insertDepenseSchema>;
export type Depense = typeof depensesTable.$inferSelect;
