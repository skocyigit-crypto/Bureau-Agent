import { pgTable, serial, integer, varchar, text, timestamp, numeric, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { organisationsTable } from "./organisations";

export const OVERAGE_RATES = {
  extraUserPerMonth: 10,
  extraContactsPer100: 2,
  extraCallsPer100: 3,
} as const;

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  periodLabel: varchar("period_label", { length: 20 }).notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  plan: varchar("plan", { length: 50 }).notNull(),
  /**
   * Numero de facture, attribue au moment de l'EMISSION et jamais avant.
   *
   * Nul tant que la facture est un brouillon: un brouillon abandonne
   * consommerait sinon un numero et ouvrirait un trou dans la sequence, ce que
   * l'article 242 nonies A de l'annexe II au CGI interdit precisement. La
   * contrainte d'unicite est partielle pour la meme raison — plusieurs
   * brouillons coexistent, tous sans numero.
   */
  reference: varchar("reference", { length: 30 }),
  /** Date d'emission. Nulle tant que la facture est un brouillon. */
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  baseAmount: numeric("base_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  overageAmount: numeric("overage_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  /**
   * Total HORS TAXES. C'est ce que cette colonne a toujours contenu — les prix
   * affiches et les tarifs de depassement sont HT, comme le disent les CGV —
   * mais rien ne le nommait, et rien ne portait la TVA. Le nom est conserve
   * pour ne pas reinterpreter les lignes existantes; `totalTtc` est la somme
   * reellement due.
   */
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Taux de TVA applique, en pourcentage. Fige a l'emission. */
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  /** Montant de TVA. Une facture sans ligne de TVA n'est pas une facture valable. */
  vatAmount: numeric("vat_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Total toutes taxes comprises: ce que le client doit payer. */
  totalTtc: numeric("total_ttc", { precision: 10, scale: 2 }).notNull().default("0"),
  /**
   * Identite du client telle qu'elle etait a l'emission.
   *
   * Une facture doit designer l'acheteur, et rester lisible dix ans plus tard.
   * Lire le nom depuis `organisations` au moment de l'affichage donnerait le
   * nom d'AUJOURD'HUI: une organisation qui change de raison sociale
   * reecrirait retroactivement toutes ses factures passees.
   */
  buyerSnapshot: jsonb("buyer_snapshot").$type<{
    name: string;
    address: string | null;
    siret: string | null;
    tvaNumber: string | null;
  }>(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  status: varchar("status", { length: 20 }).notNull().default("en_attente"),
  usageSnapshot: jsonb("usage_snapshot").$type<{
    users: { current: number; max: number; overage: number };
    contacts: { current: number; max: number; overage: number };
    calls: { current: number; max: number; overage: number };
    overageDetails: {
      extraUsers: number;
      extraUsersAmount: number;
      extraContacts: number;
      extraContactsAmount: number;
      extraCalls: number;
      extraCallsAmount: number;
    };
  }>(),
  notes: text("notes"),
  // Stripe invoice id (e.g. "in_..."). NULLABLE on purpose: invoices created from
  // bank uploads / manual billing have no Stripe id. Stripe-sourced rows set it so a
  // single successful payment — which fires BOTH invoice.paid AND
  // invoice.payment_succeeded (distinct event ids) — is recorded only once via the
  // partial unique index below + onConflictDoNothing.
  stripeInvoiceId: varchar("stripe_invoice_id", { length: 255 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("invoices_org_id_idx").on(table.organisationId),
  index("invoices_status_idx").on(table.status),
  uniqueIndex("invoices_stripe_invoice_id_unique").on(table.stripeInvoiceId),
  // Partielle: les brouillons n'ont pas encore de numero, et plusieurs `NULL`
  // doivent pouvoir coexister. Deux factures emises ne peuvent jamais partager
  // un numero — c'est la garantie que la sequence tient, meme si le code qui
  // l'attribue venait a regresser.
  uniqueIndex("invoices_reference_unique").on(table.reference),
]);

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id, { onDelete: "set null" }),
  // Volontairement NULLABLE: les releves bancaires (source "bank_upload") sont
  // importes AVANT d'etre rapproches d'une facture; tant qu'un paiement n'est pas
  // reconcilie, il n'est rattache a aucune organisation. L'org est renseignee au
  // moment du matching (voir /billing/upload-bank + reconciliation).
  organisationId: integer("organisation_id").references(() => organisationsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  source: varchar("source", { length: 30 }).notNull().default("bank_upload"),
  bankRef: varchar("bank_ref", { length: 200 }),
  bankDate: timestamp("bank_date", { withTimezone: true }),
  payerName: varchar("payer_name", { length: 200 }),
  payerIban: varchar("payer_iban", { length: 50 }),
  matchedBy: varchar("matched_by", { length: 20 }).default("manual"),
  matchConfidence: numeric("match_confidence", { precision: 5, scale: 2 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  rawLine: text("raw_line"),
  /**
   * Empreinte de l'ecriture bancaire d'origine, pour ne pas l'importer deux fois.
   *
   * Le meme releve redepose — par prudence, par erreur, ou parce qu'un mois
   * chevauche le precedent — creait autant de paiements en double, et donc
   * autant de factures soldees a tort. Rien ne l'empechait: aucune contrainte
   * d'unicite n'existait sur cette table.
   *
   * L'empreinte combine ce que la banque affirme (sa propre reference
   * d'ecriture) et ce qu'on observe: date, montant, devise, reference de bout
   * en bout, IBAN du payeur, debut de la communication. On ne se fie pas a la
   * seule reference de la banque — la norme la veut unique, mais toutes ne
   * l'honorent pas.
   *
   * NULL pour les paiements saisis autrement: l'index est partiel, plusieurs
   * NULL coexistent.
   */
  bankFingerprint: text("bank_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("payments_org_id_idx").on(table.organisationId),
  index("payments_invoice_idx").on(table.invoiceId),
  // La garantie est ICI, pas dans le code d'import: une verification
  // applicative laisse passer deux imports simultanes, une contrainte non.
  uniqueIndex("payments_bank_fingerprint_unique").on(table.bankFingerprint),
]);

export type Invoice = typeof invoicesTable.$inferSelect;
export type InsertInvoice = typeof invoicesTable.$inferInsert;
export type Payment = typeof paymentsTable.$inferSelect;
export type InsertPayment = typeof paymentsTable.$inferInsert;
