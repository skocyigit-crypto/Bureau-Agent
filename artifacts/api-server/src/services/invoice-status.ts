/**
 * Etat d'une facture: ce qui est SAISI et ce qui est DEDUIT.
 *
 * Trois des six statuts (`payee`, `partiellement_payee`, `en_retard`) ne sont
 * pas des decisions humaines: ils decoulent mecaniquement du montant regle, du
 * total et de l'echeance. Ils etaient pourtant traites comme des saisies, et
 * `en_retard` n'etait ecrit par AUCUN chemin de code — ni route, ni cron. Les
 * requetes qui comptaient les impayes par `status = 'en_retard'` renvoyaient
 * donc toujours zero, pendant que d'autres endroits (tresorerie, relances,
 * insights) calculaient le retard a partir de `dueDate` et donnaient, eux, le
 * bon chiffre. Deux definitions du retard coexistaient, dont une vide.
 *
 * Ce module est la definition unique. Meme discipline que `invoice-totals.ts`
 * pour l'argent: on DEDUIT plutot que de faire confiance a une colonne qui a
 * pu deriver.
 */
import { and, eq, gt, isNotNull, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { facturesClientTable } from "@workspace/db";

/** Statuts qui representent une facture encore due. */
export const UNPAID_STATUSES = ["envoyee", "partiellement_payee", "en_retard"] as const;

/** Statuts qui closent la facture: plus rien n'est attendu du client. */
export const SETTLED_STATUSES = ["payee", "annulee"] as const;

export interface InvoiceStateInput {
  status: string;
  paidAmount?: string | number | null;
  totalAmount?: string | number | null;
  dueDate?: Date | string | null;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Une facture est en retard si son echeance est passee et qu'il reste quelque
 * chose a encaisser. Un brouillon ne l'est jamais: il n'a pas ete envoye.
 */
export function isInvoiceOverdue(invoice: InvoiceStateInput, now: Date = new Date()): boolean {
  if (invoice.status === "payee" || invoice.status === "annulee" || invoice.status === "brouillon") return false;
  const due = toDate(invoice.dueDate);
  if (!due || due.getTime() >= now.getTime()) return false;
  return toNumber(invoice.totalAmount) - toNumber(invoice.paidAmount) > 0;
}

/**
 * Statut deduit du reglement et de l'echeance. Renvoie `null` quand rien n'est
 * a deduire (l'etat saisi fait foi).
 *
 * Les etats saisis par un humain sont respectes: `brouillon` (pas encore
 * emise) et `annulee` (decision commerciale) ne sont jamais ecrases.
 */
export function deriveInvoiceStatus(invoice: InvoiceStateInput, now: Date = new Date()): string | null {
  if (invoice.status === "brouillon" || invoice.status === "annulee") return null;

  const total = toNumber(invoice.totalAmount);
  const paid = toNumber(invoice.paidAmount);

  // Une facture a zero n'est pas "payee" par accident: sans montant, il n'y a
  // rien a deduire du reglement.
  if (total > 0 && paid >= total) return invoice.status === "payee" ? null : "payee";
  if (isInvoiceOverdue({ ...invoice, status: invoice.status }, now)) {
    return invoice.status === "en_retard" ? null : "en_retard";
  }
  if (paid > 0 && paid < total) {
    return invoice.status === "partiellement_payee" ? null : "partiellement_payee";
  }
  return null;
}

/**
 * Condition SQL "cette facture est en retard", pour les requetes qui comptent
 * les impayes. Remplace `eq(status, 'en_retard')`, qui ne matchait jamais.
 */
export function overdueCondition(now: Date = new Date()): SQL {
  return and(
    isNotNull(facturesClientTable.dueDate),
    lt(facturesClientTable.dueDate, now),
    notInArray(facturesClientTable.status, ["payee", "annulee", "brouillon"]),
    gt(
      sql`${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)`,
      sql`0`,
    ),
  )!;
}

/** Somme restant a encaisser sur les factures en retard. */
export function overdueRemainingSql() {
  return sql<number>`coalesce(sum(${facturesClientTable.totalAmount}::numeric - coalesce(${facturesClientTable.paidAmount}::numeric, 0)), 0)::numeric`;
}

/** Condition "facture encore due" (echeance passee ou non). */
export function unpaidCondition(): SQL {
  return and(
    ne(facturesClientTable.status, "payee"),
    ne(facturesClientTable.status, "annulee"),
    ne(facturesClientTable.status, "brouillon"),
  )!;
}

/** Vrai si la facture est close (plus rien a encaisser ni a relancer). */
export const isSettledStatus = (status: string): boolean =>
  (SETTLED_STATUSES as readonly string[]).includes(status);
