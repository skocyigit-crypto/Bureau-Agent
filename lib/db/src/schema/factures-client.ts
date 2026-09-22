import { pgTable, serial, integer, text, timestamp, numeric, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organisationsTable } from "./organisations";
import { contactsTable } from "./contacts";
import { devisTable } from "./devis";

export const facturesClientTable = pgTable("factures_client", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisationsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  devisId: integer("devis_id").references(() => devisTable.id, { onDelete: "set null" }),
  reference: text("reference").notNull(),
  title: text("title").notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  clientAddress: text("client_address"),
  clientCompany: text("client_company"),
  /**
   * Les quatre mentions rendues obligatoires par le decret n° 2022-1299, qui
   * les insere a l'article 242 nonies A de l'annexe II au CGI. Elles sont
   * exigees des PME sur les factures emises a partir du 1er septembre 2027;
   * le defaut de mention est sanctionne par l'article 1737 du CGI — 15 € par
   * mention manquante, dans la limite du quart du montant de la facture.
   *
   * Toutes nullables a dessein: les factures deja emises ne les portent pas et
   * ne doivent pas etre reecrites — une facture emise est immuable. Elles se
   * renseignent a l'emission des nouvelles.
   */
  /**
   * SIREN ou SIRET du client. Ce n'est plus une donnee administrative parmi
   * d'autres: dans la facturation electronique, c'est l'ADRESSE DE ROUTAGE
   * dans l'annuaire central. Mal recopie, la facture n'est jamais delivree, et
   * l'emetteur l'apprend par le retard de paiement. Voir `services/siren.ts`,
   * qui arrete la faute de frappe avant l'emission.
   */
  clientSiren: text("client_siren"),
  /**
   * Adresse de livraison, quand elle differe de l'adresse de facturation.
   * Nulle quand elle est identique — c'est le cas courant, et la dupliquer
   * ferait diverger les deux copies a la premiere correction.
   */
  deliveryAddress: text("delivery_address"),
  /**
   * Categorie de l'operation: "biens" | "services" | "mixte". Elle determine
   * l'exigibilite de la TVA, elle n'est pas decorative. Les libelles sont dans
   * `services/siren.ts`: le texte reglementaire les fixe.
   */
  operationCategory: text("operation_category"),
  /**
   * Option pour le paiement de la TVA d'apres les debits. Vrai fait porter a
   * la facture la mention exigee, recopiee a l'identique.
   */
  vatOnDebits: boolean("vat_on_debits").notNull().default(false),
  items: jsonb("items").$type<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    total: number;
  }[]>().default([]),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("EUR"),
  // Autoliquidation de TVA (sous-traitance BTP) : si vrai, la trésorerie
  // encaisse le HT (subtotal) et non le TTC (totalAmount). Pilier risque.
  isAutoliquidation: boolean("is_autoliquidation").notNull().default(false),

  // --- Retenue de garantie (loi n° 71-584 du 16 juillet 1971) --------------
  //
  // Le maitre d'ouvrage retient une part du prix pour couvrir les reserves,
  // et la loi qui l'encadre est D'ORDRE PUBLIC : le taux ne peut depasser
  // 5 %, la somme doit etre CONSIGNEE entre les mains d'un consignataire —
  // pas simplement gardee par le client — et elle est versee a l'entrepreneur
  // un an apres la reception, meme sans mainlevee, faute d'opposition motivee.
  //
  // Le taux est stocke, jamais le montant : le montant se deduit du total, et
  // deux valeurs pour une meme grandeur finissent toujours par diverger.
  //
  // Un taux SUPERIEUR a 5 % est enregistre quand meme. La retenue est imposee
  // par le client, pas choisie par l'utilisateur : refuser la saisie
  // reviendrait a lui interdire de decrire son propre chantier. L'exces est
  // signale comme recuperable.
  retenueGarantieRate: numeric("retenue_garantie_rate", { precision: 5, scale: 2 }).notNull().default("0"),

  // La retenue n'est PAS pratiquee lorsque l'entrepreneur fournit une caution
  // personnelle et solidaire d'un etablissement financier (art. 2 de la loi).
  // Dans ce cas la somme reste due immediatement, et c'est la banque qui porte
  // le risque.
  cautionBancaire: boolean("caution_bancaire").notNull().default(false),
  status: text("status").notNull().default("brouillon"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  conditions: text("conditions"),
  reminderCount: integer("reminder_count").notNull().default(0),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  // Transmission a la plateforme agreee (API AFNOR XP Z12-013). Toutes
  // nullables : une facture jamais transmise n'a rien ici.
  /** Identifiant du flux rendu par la plateforme (flowId). */
  paFlowId: text("pa_flow_id"),
  /** Accuse de la plateforme : Pending, Ok ou Error (FlowAckStatus). */
  paStatut: text("pa_statut"),
  paTransmiseLe: timestamp("pa_transmise_le", { withTimezone: true }),
  /** Motifs d'anomalie renvoyes par la plateforme (AcknowledgementDetails). */
  paDetail: jsonb("pa_detail").$type<Array<{ item: string; level: string; reasonCode: string; reasonMessage: string }>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Le numero de facture est unique DANS l'organisation, et la base le garantit.
  // Il ne l'etait qu'applicativement (lire puis inserer), ce qui laisse passer
  // deux numeros identiques quand deux instances Cloud Run ecrivent au meme
  // instant — et un doublon de numero de facture n'est pas un defaut cosmetique:
  // il rend la piste d'audit incoherente pour l'administration fiscale.
  uniqueIndex("factures_client_org_reference_unique").on(table.organisationId, table.reference),
  index("factures_client_org_id_idx").on(table.organisationId),
  index("factures_client_status_idx").on(table.status),
  index("factures_client_contact_id_idx").on(table.contactId),
  // Accent-insensitive trigram search index used by the Commandant chat
  // retriever and smart search. Requires `pg_trgm` + `unaccent` and the
  // IMMUTABLE `f_unaccent()` wrapper (see lib/db/scripts/ensure-search-extensions.sql).
  index("factures_client_search_trgm_idx").using(
    "gin",
    sql`f_unaccent(${table.reference}) gin_trgm_ops`,
    sql`f_unaccent(${table.clientName}) gin_trgm_ops`,
  ),
]);

export type FactureClient = typeof facturesClientTable.$inferSelect;
export type InsertFactureClient = typeof facturesClientTable.$inferInsert;
