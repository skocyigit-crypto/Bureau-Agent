import { db } from "@workspace/db";
import {
  contactsTable, tasksTable, prospectsTable, calendarEventsTable,
  callsTable, messagesTable, facturesClientTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, lte, sql, ilike, or } from "drizzle-orm";
import { ensureUnaccentExtension, accentInsensitiveIlike } from "../helpers/accent-search";
import { sendEmail } from "./email";
import { sendSms as providerSendSms } from "./telephony-providers";
import { generateImage } from "@workspace/integrations-gemini-ai/image";
import { buildExcelBase64, buildWordBase64, buildPdfBase64, buildPptxBase64 } from "./document-export";
import { ingestDocument } from "./document-ingest";
import { searchKnowledge } from "./knowledge-base";
import { logger } from "../lib/logger";

export interface ToolContext {
  orgId: number;
  userId: number;
}

export type FieldSpec =
  | { kind: "string"; required?: boolean; min?: number; max?: number; enum?: readonly string[]; email?: boolean }
  | { kind: "number"; required?: boolean; min?: number; max?: number; integer?: boolean }
  | { kind: "iso-date"; required?: boolean };

export interface ToolDef<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  /** Field-by-field validation spec used at execution time. */
  fields: Record<string, FieldSpec>;
  /** If true, the engine MUST NOT call execute() directly — it must emit a
   *  pending_action event and wait for an explicit user approve/reject. */
  requiresConfirmation?: boolean;
  /** Short human-readable summary of what running this tool will do. */
  summarize?: (args: TArgs) => string;
  execute: (args: TArgs, ctx: ToolContext) => Promise<unknown>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function validateArgs(
  fields: Record<string, FieldSpec>,
  raw: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (raw == null || typeof raw !== "object") return { ok: false, error: "arguments doivent etre un objet" };
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const v = input[key];
    if (v == null || v === "") {
      if (spec.required) return { ok: false, error: `${key} est obligatoire` };
      continue;
    }
    if (spec.kind === "string") {
      if (typeof v !== "string") return { ok: false, error: `${key} doit etre une chaine` };
      if (spec.min != null && v.length < spec.min) return { ok: false, error: `${key} trop court (min ${spec.min})` };
      if (spec.max != null && v.length > spec.max) return { ok: false, error: `${key} trop long (max ${spec.max})` };
      if (spec.email && !EMAIL_RE.test(v)) return { ok: false, error: `${key} doit etre un e-mail valide` };
      if (spec.enum && !spec.enum.includes(v)) return { ok: false, error: `${key} doit etre l'une de: ${spec.enum.join(", ")}` };
      out[key] = v;
    } else if (spec.kind === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return { ok: false, error: `${key} doit etre un nombre` };
      if (spec.integer && !Number.isInteger(n)) return { ok: false, error: `${key} doit etre un entier` };
      if (spec.min != null && n < spec.min) return { ok: false, error: `${key} doit etre >= ${spec.min}` };
      if (spec.max != null && n > spec.max) return { ok: false, error: `${key} doit etre <= ${spec.max}` };
      out[key] = n;
    } else if (spec.kind === "iso-date") {
      if (typeof v !== "string" || !ISO_DATE_RE.test(v)) return { ok: false, error: `${key} doit etre une date ISO 8601` };
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return { ok: false, error: `${key} date invalide` };
      out[key] = v;
    }
  }
  return { ok: true, data: out };
}

const trim = (s: unknown, n = 200): string => {
  const v = String(s ?? "");
  return v.length > n ? v.slice(0, n) + "…" : v;
};

// Field specs (one per tool, defined inline below)
const F_QUERY_LIMIT: Record<string, FieldSpec> = {
  query: { kind: "string", max: 200 },
  limit: { kind: "number", integer: true, min: 1, max: 50 },
};
const F_STATUS_LIMIT: Record<string, FieldSpec> = {
  status: { kind: "string", max: 50 },
  limit: { kind: "number", integer: true, min: 1, max: 50 },
};
const F_STAGE_LIMIT: Record<string, FieldSpec> = {
  stage: { kind: "string", max: 50 },
  limit: { kind: "number", integer: true, min: 1, max: 50 },
};
const F_LIMIT_ONLY: Record<string, FieldSpec> = {
  limit: { kind: "number", integer: true, min: 1, max: 50 },
};
const F_DATE_RANGE: Record<string, FieldSpec> = {
  start: { kind: "iso-date" },
  end: { kind: "iso-date" },
};

// Tool registry — strongly typed
const ALL_TOOLS: ReadonlyArray<ToolDef<any>> = [
  {
    name: "get_current_datetime",
    description: "Retourne la date et l'heure actuelles (Europe/Paris).",
    parameters: { type: "object", properties: {} },
    fields: {},
    execute: async () => ({
      iso: new Date().toISOString(),
      humanFr: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
    }),
  },
  {
    name: "get_dashboard_summary",
    description: "Resume rapide de l'activite (nb contacts, taches, prospects, factures impayees, appels du jour).",
    parameters: { type: "object", properties: {} },
    fields: {},
    execute: async (_a, { orgId }) => {
      const [c, t, p, f, calls] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.organisationId, orgId)),
        db.select({ n: sql<number>`count(*)::int` }).from(tasksTable).where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente"))),
        db.select({ n: sql<number>`count(*)::int` }).from(prospectsTable).where(eq(prospectsTable.organisationId, orgId)),
        db.select({ n: sql<number>`count(*)::int` }).from(facturesClientTable).where(and(eq(facturesClientTable.organisationId, orgId), or(eq(facturesClientTable.status, "envoyee"), eq(facturesClientTable.status, "en_attente"), eq(facturesClientTable.status, "en_retard"))!)),
        db.select({ n: sql<number>`count(*)::int` }).from(callsTable).where(and(eq(callsTable.organisationId, orgId), gte(callsTable.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))),
      ]);
      return {
        contacts: c[0]?.n ?? 0,
        tachesEnAttente: t[0]?.n ?? 0,
        prospects: p[0]?.n ?? 0,
        facturesImpayees: f[0]?.n ?? 0,
        appels24h: calls[0]?.n ?? 0,
      };
    },
  },
  {
    name: "get_financial_summary",
    description: "Resume FINANCIER en montants (EUR): total restant a encaisser (factures impayees), montant en retard (echeance depassee), et chiffre encaisse ce mois-ci. Utilise-le quand on demande 'combien on me doit', 'combien en retard', 'le CA/chiffre d'affaires du mois', les impayes en argent (pas seulement le nombre).",
    parameters: { type: "object", properties: {} },
    fields: {},
    execute: async (_a, { orgId }) => {
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [row] = await db.select({
        restantAEncaisser: sql<number>`coalesce(sum(${facturesClientTable.totalAmount} - ${facturesClientTable.paidAmount}) filter (where ${facturesClientTable.status} in ('envoyee','en_attente','en_retard')), 0)::float8`,
        facturesImpayees: sql<number>`count(*) filter (where ${facturesClientTable.status} in ('envoyee','en_attente','en_retard'))::int`,
        montantEnRetard: sql<number>`coalesce(sum(${facturesClientTable.totalAmount} - ${facturesClientTable.paidAmount}) filter (where ${facturesClientTable.status} in ('envoyee','en_attente','en_retard') and ${facturesClientTable.dueDate} is not null and ${facturesClientTable.dueDate} < now()), 0)::float8`,
        facturesEnRetard: sql<number>`count(*) filter (where ${facturesClientTable.status} in ('envoyee','en_attente','en_retard') and ${facturesClientTable.dueDate} is not null and ${facturesClientTable.dueDate} < now())::int`,
        encaisseCeMois: sql<number>`coalesce(sum(${facturesClientTable.paidAmount}) filter (where ${facturesClientTable.paidAt} >= ${monthStart}), 0)::float8`,
        facturesPayeesCeMois: sql<number>`count(*) filter (where ${facturesClientTable.paidAt} >= ${monthStart})::int`,
      }).from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
      const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
      return {
        devise: "EUR",
        restantAEncaisser: round2(row?.restantAEncaisser ?? 0),
        facturesImpayees: row?.facturesImpayees ?? 0,
        montantEnRetard: round2(row?.montantEnRetard ?? 0),
        facturesEnRetard: row?.facturesEnRetard ?? 0,
        encaisseCeMois: round2(row?.encaisseCeMois ?? 0),
        facturesPayeesCeMois: row?.facturesPayeesCeMois ?? 0,
      };
    },
  },
  // ---------- CONTACTS ----------
  {
    name: "list_contacts",
    description: "Liste les contacts. Optionnellement filtrer par recherche (nom, prenom, entreprise, email, telephone).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texte a rechercher (optionnel)" },
        limit: { type: "integer", description: "Max 50, defaut 20" },
      },
    },
    fields: F_QUERY_LIMIT,
    execute: async (a, { orgId }) => {
      const limit = a.limit ?? 20;
      const conds = [eq(contactsTable.organisationId, orgId)];
      if (a.query) {
        const q = `%${a.query}%`;
        const useUnaccent = await ensureUnaccentExtension();
        conds.push(or(
          accentInsensitiveIlike(contactsTable.firstName, q, useUnaccent),
          accentInsensitiveIlike(contactsTable.lastName, q, useUnaccent),
          accentInsensitiveIlike(contactsTable.company, q, useUnaccent),
          accentInsensitiveIlike(contactsTable.email, q, useUnaccent),
          accentInsensitiveIlike(contactsTable.phone, q, useUnaccent),
        )!);
      }
      const rows = await db.select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        company: contactsTable.company,
        email: contactsTable.email,
        phone: contactsTable.phone,
      }).from(contactsTable).where(and(...conds)).orderBy(desc(contactsTable.createdAt)).limit(limit);
      return { count: rows.length, contacts: rows };
    },
  },
  {
    name: "create_contact",
    description: "Cree un nouveau contact. firstName/lastName/phone obligatoires.",
    parameters: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        phone: { type: "string", description: "Format international si possible (+33...)" },
        email: { type: "string" },
        company: { type: "string" },
        category: { type: "string", description: "ex: client, prospect, fournisseur, autre" },
        notes: { type: "string" },
      },
      required: ["firstName", "lastName", "phone"],
    },
    fields: {
      firstName: { kind: "string", required: true, min: 1, max: 120 },
      lastName: { kind: "string", required: true, min: 1, max: 120 },
      phone: { kind: "string", required: true, min: 3, max: 40 },
      email: { kind: "string", email: true, max: 200 },
      company: { kind: "string", max: 200 },
      category: { kind: "string", max: 50 },
      notes: { kind: "string", max: 2000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer le contact ${a.firstName} ${a.lastName} (${a.phone})`,
    execute: async (a, { orgId, userId }) => {
      const [row] = await db.insert(contactsTable).values({
        organisationId: orgId,
        firstName: a.firstName,
        lastName: a.lastName,
        phone: a.phone,
        email: a.email ?? null,
        company: a.company ?? null,
        category: a.category ?? "autre",
        notes: a.notes ?? null,
        createdBy: userId,
      }).returning({ id: contactsTable.id });
      return { success: true, id: row.id, url: `/contacts/${row.id}` };
    },
  },
  {
    name: "update_contact",
    description:
      "Met a jour un contact existant: prenom, nom, telephone, e-mail, entreprise, categorie ou notes. " +
      "Fournir l'id du contact et au moins un champ a modifier. Les champs non fournis restent inchanges. " +
      "Categorie valide: client, prospect, fournisseur, partenaire, autre. NECESSITE UNE CONFIRMATION EXPLICITE.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID du contact a modifier" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        phone: { type: "string", description: "Format international si possible (+33...)" },
        email: { type: "string" },
        company: { type: "string" },
        category: { type: "string", description: "client, prospect, fournisseur, partenaire, autre" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
    fields: {
      id: { kind: "number", required: true, integer: true, min: 1 },
      firstName: { kind: "string", min: 1, max: 120 },
      lastName: { kind: "string", min: 1, max: 120 },
      phone: { kind: "string", min: 3, max: 40 },
      email: { kind: "string", email: true, max: 200 },
      company: { kind: "string", max: 200 },
      category: { kind: "string", enum: ["client", "prospect", "fournisseur", "partenaire", "autre"] as const },
      notes: { kind: "string", max: 2000 },
    },
    requiresConfirmation: true,
    summarize: (a) => {
      const parts: string[] = [];
      if (a.firstName != null || a.lastName != null) parts.push(`nom → ${[a.firstName, a.lastName].filter(Boolean).join(" ")}`);
      if (a.phone != null) parts.push(`telephone → ${a.phone}`);
      if (a.email != null) parts.push(`e-mail → ${a.email}`);
      if (a.company != null) parts.push(`entreprise → ${trim(a.company, 60)}`);
      if (a.category != null) parts.push(`categorie → ${a.category}`);
      if (a.notes != null) parts.push("notes mises a jour");
      return `Mettre a jour le contact #${a.id}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    },
    execute: async (a, { orgId, userId }) => {
      const updates: Record<string, unknown> = { updatedBy: userId };
      if (a.firstName != null) updates.firstName = a.firstName;
      if (a.lastName != null) updates.lastName = a.lastName;
      if (a.phone != null) updates.phone = a.phone;
      if (a.email != null) updates.email = a.email;
      if (a.company != null) updates.company = a.company;
      if (a.category != null) updates.category = a.category;
      if (a.notes != null) updates.notes = a.notes;
      if (Object.keys(updates).length <= 1) {
        return { success: false, error: "Aucune modification fournie (prenom, nom, telephone, e-mail, entreprise, categorie ou notes)." };
      }
      const [row] = await db.update(contactsTable).set(updates)
        .where(and(eq(contactsTable.id, a.id), eq(contactsTable.organisationId, orgId)))
        .returning({ id: contactsTable.id, firstName: contactsTable.firstName, lastName: contactsTable.lastName });
      if (!row) return { success: false, error: "Contact introuvable dans votre organisation." };
      return { success: true, id: row.id, firstName: row.firstName, lastName: row.lastName, url: `/contacts/${row.id}` };
    },
  },
  // ---------- TASKS ----------
  {
    name: "list_tasks",
    description: "Liste les taches, optionnellement filtrees par statut (en_attente, en_cours, termine, annule).",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "integer" },
      },
    },
    fields: F_STATUS_LIMIT,
    execute: async (a, { orgId }) => {
      const limit = a.limit ?? 20;
      const conds = [eq(tasksTable.organisationId, orgId)];
      if (a.status) conds.push(eq(tasksTable.status, a.status));
      const rows = await db.select({
        id: tasksTable.id, title: tasksTable.title, status: tasksTable.status,
        priority: tasksTable.priority, dueDate: tasksTable.dueDate,
      }).from(tasksTable).where(and(...conds)).orderBy(desc(tasksTable.createdAt)).limit(limit);
      return { count: rows.length, tasks: rows };
    },
  },
  {
    name: "create_task",
    description: "Cree une nouvelle tache.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "ISO 8601, optionnel" },
        priority: { type: "string", description: "basse, moyenne, haute" },
      },
      required: ["title"],
    },
    fields: {
      title: { kind: "string", required: true, min: 1, max: 300 },
      description: { kind: "string", max: 4000 },
      dueDate: { kind: "iso-date" },
      priority: { kind: "string", enum: ["basse", "moyenne", "haute"] as const },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer la tache "${a.title}"${a.dueDate ? ` (echeance ${a.dueDate})` : ""}`,
    execute: async (a, { orgId, userId }) => {
      const due = a.dueDate ? new Date(a.dueDate) : null;
      if (due && Number.isNaN(due.getTime())) {
        return { success: false, error: "dueDate invalide (utilisez ISO 8601)." };
      }
      const [row] = await db.insert(tasksTable).values({
        organisationId: orgId,
        title: a.title,
        description: a.description ?? null,
        priority: a.priority ?? "moyenne",
        dueDate: due,
        createdBy: userId,
      }).returning({ id: tasksTable.id });
      return { success: true, id: row.id, url: `/taches` };
    },
  },
  {
    name: "update_task",
    description:
      "Met a jour une tache existante: statut, priorite, titre, description ou echeance. " +
      "Statut valide: en_attente, en_cours, termine, annule. Priorite: basse, moyenne, haute. " +
      "Fournir l'id de la tache et au moins un champ a modifier. NECESSITE UNE CONFIRMATION EXPLICITE.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID de la tache a modifier" },
        status: { type: "string", description: "en_attente, en_cours, termine, annule" },
        priority: { type: "string", description: "basse, moyenne, haute" },
        title: { type: "string" },
        description: { type: "string" },
        dueDate: { type: "string", description: "ISO 8601, optionnel" },
      },
      required: ["id"],
    },
    fields: {
      id: { kind: "number", required: true, integer: true, min: 1 },
      status: { kind: "string", enum: ["en_attente", "en_cours", "termine", "annule"] as const },
      priority: { kind: "string", enum: ["basse", "moyenne", "haute"] as const },
      title: { kind: "string", min: 1, max: 300 },
      description: { kind: "string", max: 4000 },
      dueDate: { kind: "iso-date" },
    },
    requiresConfirmation: true,
    summarize: (a) => {
      const parts: string[] = [];
      if (a.status) parts.push(`statut → ${a.status}`);
      if (a.priority) parts.push(`priorite → ${a.priority}`);
      if (a.title) parts.push(`titre → « ${trim(a.title, 60)} »`);
      if (a.dueDate) parts.push(`echeance → ${a.dueDate}`);
      if (a.description != null) parts.push("description mise a jour");
      return `Mettre a jour la tache #${a.id}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    },
    execute: async (a, { orgId, userId }) => {
      const updates: Record<string, unknown> = { updatedBy: userId };
      if (a.status != null) updates.status = a.status;
      if (a.priority != null) updates.priority = a.priority;
      if (a.title != null) updates.title = a.title;
      if (a.description != null) updates.description = a.description;
      if (a.dueDate != null) {
        const due = new Date(a.dueDate);
        if (Number.isNaN(due.getTime())) {
          return { success: false, error: "dueDate invalide (utilisez ISO 8601)." };
        }
        updates.dueDate = due;
      }
      if (Object.keys(updates).length <= 1) {
        return { success: false, error: "Aucune modification fournie (statut, priorite, titre, description ou echeance)." };
      }
      const [row] = await db.update(tasksTable).set(updates)
        .where(and(eq(tasksTable.id, a.id), eq(tasksTable.organisationId, orgId)))
        .returning({ id: tasksTable.id, status: tasksTable.status });
      if (!row) return { success: false, error: "Tache introuvable dans votre organisation." };
      return { success: true, id: row.id, status: row.status, url: "/taches" };
    },
  },
  // ---------- PROSPECTS ----------
  {
    name: "list_prospects",
    description: "Liste les prospects, optionnellement filtres par etape (nouveau, contact, qualification, proposition, negociation, gagne, perdu).",
    parameters: {
      type: "object",
      properties: { stage: { type: "string" }, limit: { type: "integer" } },
    },
    fields: F_STAGE_LIMIT,
    execute: async (a, { orgId }) => {
      const limit = a.limit ?? 20;
      const conds = [eq(prospectsTable.organisationId, orgId)];
      if (a.stage) conds.push(eq(prospectsTable.stage, a.stage));
      const rows = await db.select({
        id: prospectsTable.id, title: prospectsTable.title, company: prospectsTable.company,
        stage: prospectsTable.stage, value: prospectsTable.value,
      }).from(prospectsTable).where(and(...conds)).orderBy(desc(prospectsTable.createdAt)).limit(limit);
      return { count: rows.length, prospects: rows };
    },
  },
  {
    name: "create_prospect",
    description: "Cree un nouveau prospect.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        company: { type: "string" },
        contactName: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        value: { type: "number", description: "Montant estime en EUR" },
        stage: { type: "string", description: "nouveau, contact, qualification, proposition, negociation, gagne, perdu" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
    fields: {
      title: { kind: "string", required: true, min: 1, max: 300 },
      company: { kind: "string", max: 200 },
      contactName: { kind: "string", max: 200 },
      phone: { kind: "string", max: 40 },
      email: { kind: "string", email: true, max: 200 },
      value: { kind: "number", min: 0 },
      stage: { kind: "string", enum: ["nouveau", "contact", "qualification", "proposition", "negociation", "gagne", "perdu"] as const },
      notes: { kind: "string", max: 4000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer le prospect "${a.title}"${a.company ? ` chez ${a.company}` : ""}${a.value ? ` (${a.value} EUR)` : ""}`,
    execute: async (a, { orgId }) => {
      const [row] = await db.insert(prospectsTable).values({
        organisationId: orgId,
        title: a.title,
        company: a.company ?? null,
        contactName: a.contactName ?? null,
        phone: a.phone ?? null,
        email: a.email ?? null,
        stage: a.stage ?? "nouveau",
        value: a.value != null ? String(a.value) : null,
        notes: a.notes ?? null,
      }).returning({ id: prospectsTable.id });
      return { success: true, id: row.id, url: "/prospects" };
    },
  },
  {
    name: "advance_prospect",
    description:
      "Fait progresser un prospect existant vers une nouvelle etape du pipeline. " +
      "Etapes valides (ordre): nouveau, contact, qualification, proposition, negociation, gagne, perdu. " +
      "Fournir l'id du prospect et l'etape cible. NECESSITE UNE CONFIRMATION EXPLICITE.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID du prospect" },
        stage: { type: "string", description: "nouveau, contact, qualification, proposition, negociation, gagne, perdu" },
        lostReason: { type: "string", description: "Raison de la perte (si stage = perdu)" },
      },
      required: ["id", "stage"],
    },
    fields: {
      id: { kind: "number", required: true, integer: true, min: 1 },
      stage: { kind: "string", required: true, enum: ["nouveau", "contact", "qualification", "proposition", "negociation", "gagne", "perdu"] as const },
      lostReason: { kind: "string", max: 1000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Faire passer le prospect #${a.id} a l'etape « ${a.stage} »${a.stage === "perdu" && a.lostReason ? ` (raison: ${trim(a.lostReason, 60)})` : ""}`,
    execute: async (a, { orgId }) => {
      const updates: Record<string, unknown> = { stage: a.stage, updatedAt: new Date() };
      if (a.stage === "gagne") updates.wonAt = new Date();
      if (a.stage === "perdu") {
        updates.lostAt = new Date();
        if (a.lostReason != null) updates.lostReason = a.lostReason;
      }
      const [row] = await db.update(prospectsTable).set(updates)
        .where(and(eq(prospectsTable.id, a.id), eq(prospectsTable.organisationId, orgId)))
        .returning({ id: prospectsTable.id, stage: prospectsTable.stage });
      if (!row) return { success: false, error: "Prospect introuvable dans votre organisation." };
      return { success: true, id: row.id, stage: row.stage, url: "/prospects" };
    },
  },
  // ---------- CALENDAR ----------
  {
    name: "list_calendar_events",
    description: "Liste les evenements de l'agenda dans une fenetre. start/end en ISO. Defaut: 7 prochains jours.",
    parameters: {
      type: "object",
      properties: { start: { type: "string" }, end: { type: "string" } },
    },
    fields: F_DATE_RANGE,
    execute: async (a, { orgId }) => {
      const start = a.start ? new Date(a.start) : new Date();
      const end = a.end ? new Date(a.end) : new Date(Date.now() + 7 * 86400_000);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { error: "Dates invalides (utilisez ISO 8601)." };
      }
      const rows = await db.select({
        id: calendarEventsTable.id, title: calendarEventsTable.title,
        startDate: calendarEventsTable.startDate, endDate: calendarEventsTable.endDate,
        location: calendarEventsTable.location, type: calendarEventsTable.type,
      }).from(calendarEventsTable).where(and(
        eq(calendarEventsTable.organisationId, orgId),
        gte(calendarEventsTable.startDate, start),
        lte(calendarEventsTable.startDate, end),
      )).orderBy(calendarEventsTable.startDate).limit(50);
      return { count: rows.length, events: rows };
    },
  },
  {
    name: "create_calendar_event",
    description: "Cree un evenement dans l'agenda.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        startDate: { type: "string", description: "ISO 8601" },
        endDate: { type: "string", description: "ISO 8601" },
        description: { type: "string" },
        location: { type: "string" },
        type: { type: "string", description: "rendez_vous, reunion, appel, autre" },
      },
      required: ["title", "startDate", "endDate"],
    },
    fields: {
      title: { kind: "string", required: true, min: 1, max: 300 },
      startDate: { kind: "iso-date", required: true },
      endDate: { kind: "iso-date", required: true },
      description: { kind: "string", max: 4000 },
      location: { kind: "string", max: 300 },
      type: { kind: "string", max: 50 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer l'evenement "${a.title}" du ${a.startDate} au ${a.endDate}${a.location ? ` a ${a.location}` : ""}`,
    execute: async (a, { orgId, userId }) => {
      const start = new Date(a.startDate);
      const end = new Date(a.endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { success: false, error: "Dates invalides (utilisez ISO 8601)." };
      }
      if (end < start) {
        return { success: false, error: "endDate doit etre apres startDate." };
      }
      const [row] = await db.insert(calendarEventsTable).values({
        organisationId: orgId,
        title: a.title,
        description: a.description ?? null,
        type: a.type ?? "rendez_vous",
        startDate: start,
        endDate: end,
        location: a.location ?? null,
        createdBy: userId,
      }).returning({ id: calendarEventsTable.id });
      return { success: true, id: row.id, url: "/calendrier" };
    },
  },
  {
    name: "reschedule_calendar_event",
    description:
      "Reporte (deplace) un evenement existant de l'agenda a une nouvelle date/heure. " +
      "Fournir 'startDate' (ISO 8601). 'endDate' est optionnel: si absent, la duree initiale de l'evenement est conservee. " +
      "NECESSITE UNE CONFIRMATION EXPLICITE.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID de l'evenement a deplacer" },
        startDate: { type: "string", description: "Nouvelle date/heure de debut, ISO 8601" },
        endDate: { type: "string", description: "Nouvelle date/heure de fin, ISO 8601 (optionnel)" },
      },
      required: ["id", "startDate"],
    },
    fields: {
      id: { kind: "number", required: true, integer: true, min: 1 },
      startDate: { kind: "iso-date", required: true },
      endDate: { kind: "iso-date" },
    },
    requiresConfirmation: true,
    summarize: (a) => `Reporter l'evenement #${a.id} au ${a.startDate}${a.endDate ? ` (fin ${a.endDate})` : ""}`,
    execute: async (a, { orgId, userId }) => {
      const start = new Date(a.startDate);
      if (Number.isNaN(start.getTime())) {
        return { success: false, error: "startDate invalide (utilisez ISO 8601)." };
      }
      const [existing] = await db.select({
        id: calendarEventsTable.id,
        startDate: calendarEventsTable.startDate,
        endDate: calendarEventsTable.endDate,
      }).from(calendarEventsTable)
        .where(and(eq(calendarEventsTable.id, a.id), eq(calendarEventsTable.organisationId, orgId)));
      if (!existing) return { success: false, error: "Evenement introuvable dans votre organisation." };
      let end: Date;
      if (a.endDate != null) {
        end = new Date(a.endDate);
        if (Number.isNaN(end.getTime())) {
          return { success: false, error: "endDate invalide (utilisez ISO 8601)." };
        }
      } else {
        const origStart = new Date(existing.startDate).getTime();
        const origEnd = new Date(existing.endDate).getTime();
        const duration = Number.isFinite(origStart) && Number.isFinite(origEnd) ? Math.max(0, origEnd - origStart) : 0;
        end = new Date(start.getTime() + duration);
      }
      if (end < start) {
        return { success: false, error: "endDate doit etre apres startDate." };
      }
      const [row] = await db.update(calendarEventsTable)
        .set({ startDate: start, endDate: end, updatedBy: userId })
        .where(and(eq(calendarEventsTable.id, a.id), eq(calendarEventsTable.organisationId, orgId)))
        .returning({ id: calendarEventsTable.id, startDate: calendarEventsTable.startDate, endDate: calendarEventsTable.endDate });
      if (!row) return { success: false, error: "Evenement introuvable dans votre organisation." };
      return { success: true, id: row.id, startDate: row.startDate, endDate: row.endDate, url: "/calendrier" };
    },
  },
  // ---------- COMMS (CONFIRMATION REQUIRED) ----------
  {
    name: "send_email",
    description: "Envoie un e-mail. NECESSITE UNE CONFIRMATION EXPLICITE de l'utilisateur avant execution.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Adresse e-mail destinataire" },
        subject: { type: "string" },
        body: { type: "string", description: "Corps du message (texte ou HTML simple)" },
      },
      required: ["to", "subject", "body"],
    },
    fields: {
      to: { kind: "string", required: true, email: true, max: 200 },
      subject: { kind: "string", required: true, min: 1, max: 300 },
      body: { kind: "string", required: true, min: 1, max: 20000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Envoyer un e-mail à ${a.to} — sujet: « ${trim(a.subject, 80)} »`,
    execute: async (a, { orgId }) => {
      const html = /<\w+/.test(a.body) ? a.body : `<div style="font-family:system-ui">${a.body.replace(/\n/g, "<br>")}</div>`;
      const text = a.body.replace(/<[^>]+>/g, "");
      const r = await sendEmail(a.to, a.subject, html, text, { orgId });
      return r;
    },
  },
  {
    name: "send_sms",
    description: "Envoie un SMS via Twilio. NECESSITE UNE CONFIRMATION EXPLICITE de l'utilisateur avant execution.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Numero international (+33...)" },
        message: { type: "string" },
      },
      required: ["to", "message"],
    },
    fields: {
      to: { kind: "string", required: true, min: 3, max: 40 },
      message: { kind: "string", required: true, min: 1, max: 1600 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Envoyer un SMS à ${a.to} : « ${trim(a.message, 80)} »`,
    execute: async (a) => {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = process.env.TWILIO_PHONE_NUMBER;
      if (!sid || !token || !from) return { success: false, error: "Twilio non configure (TWILIO_*)" };
      const r = await providerSendSms("twilio", { accountSid: sid, authToken: token, fromNumber: from }, { to: a.to, body: a.message });
      return r;
    },
  },
  // ---------- AI MEDIA ----------
  {
    name: "generate_image",
    description: "Genere une image a partir d'une description (logo, illustration, visuel marketing). Retourne une URL data: pour affichage immediat.",
    parameters: {
      type: "object",
      properties: { prompt: { type: "string" } },
      required: ["prompt"],
    },
    fields: {
      prompt: { kind: "string", required: true, min: 3, max: 1000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Generer une image: "${trim(a.prompt, 120)}"`,
    execute: async (a) => {
      try {
        const img = await generateImage(a.prompt);
        return { success: true, dataUrl: `data:${img.mimeType};base64,${img.b64_json}` };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: trim(msg) };
      }
    },
  },
  // ---------- BUREAUTIQUE (Excel / Word) ----------
  {
    name: "create_excel_document",
    description:
      "Cree un fichier Excel (.xlsx) et l'enregistre dans la bibliotheque de documents (telechargeable). " +
      "Utilise pour produire tableaux, rapports, listes, suivis. Le parametre dataJson est une chaine JSON. " +
      "Format simple (une feuille): {\"columns\":[\"Nom\",\"Montant\"],\"rows\":[[\"Ali\",100],[\"Veli\",200]]}. " +
      "Format multi-feuilles: {\"sheets\":[{\"name\":\"Janvier\",\"columns\":[...],\"rows\":[[...]]}]}.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Nom du fichier (ex: 'rapport-ventes'). L'extension .xlsx est ajoutee si absente." },
        dataJson: { type: "string", description: "Chaine JSON decrivant colonnes/lignes (voir description)." },
      },
      required: ["fileName", "dataJson"],
    },
    fields: {
      fileName: { kind: "string", required: true, min: 1, max: 200 },
      dataJson: { kind: "string", required: true, min: 2, max: 200000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer un fichier Excel: « ${trim(a.fileName, 80)} »`,
    execute: async (a, { orgId, userId }) => {
      let spec: any;
      try {
        spec = JSON.parse(a.dataJson);
      } catch {
        return { success: false, error: "dataJson n'est pas un JSON valide." };
      }
      let built;
      try {
        built = await buildExcelBase64(spec, a.fileName);
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Specification Excel invalide." };
      }
      const ingest = await ingestDocument({
        orgId, userId: userId ?? null,
        fileContent: built.base64, fileName: built.fileName, mimeType: built.mimeType,
        category: "general", source: "assistant",
      });
      if (ingest.status !== "created") {
        return { success: false, error: ingest.status === "blocked" ? "Fichier bloque (securite)." : ingest.error };
      }
      return {
        success: true, documentId: ingest.doc.id, fileName: built.fileName,
        downloadPath: `/api/documents/${ingest.doc.id}/download`,
      };
    },
  },
  {
    name: "create_word_document",
    description:
      "Cree un document Word (.docx) et l'enregistre dans la bibliotheque de documents (telechargeable). " +
      "Utilise pour lettres, comptes-rendus, devis, rapports. Le parametre dataJson est une chaine JSON " +
      "avec un titre optionnel et une liste de blocs: " +
      "{\"title\":\"Rapport\",\"blocks\":[{\"type\":\"heading\",\"text\":\"Introduction\",\"level\":1}," +
      "{\"type\":\"paragraph\",\"text\":\"Texte...\"},{\"type\":\"table\",\"columns\":[\"A\",\"B\"],\"rows\":[[\"1\",\"2\"]]}]}.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Nom du fichier (ex: 'lettre-client'). L'extension .docx est ajoutee si absente." },
        dataJson: { type: "string", description: "Chaine JSON avec 'title' optionnel et 'blocks' (voir description)." },
      },
      required: ["fileName", "dataJson"],
    },
    fields: {
      fileName: { kind: "string", required: true, min: 1, max: 200 },
      dataJson: { kind: "string", required: true, min: 2, max: 200000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer un document Word: « ${trim(a.fileName, 80)} »`,
    execute: async (a, { orgId, userId }) => {
      let spec: any;
      try {
        spec = JSON.parse(a.dataJson);
      } catch {
        return { success: false, error: "dataJson n'est pas un JSON valide." };
      }
      let built;
      try {
        built = await buildWordBase64(spec, a.fileName);
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Specification Word invalide." };
      }
      const ingest = await ingestDocument({
        orgId, userId: userId ?? null,
        fileContent: built.base64, fileName: built.fileName, mimeType: built.mimeType,
        category: "general", source: "assistant",
      });
      if (ingest.status !== "created") {
        return { success: false, error: ingest.status === "blocked" ? "Fichier bloque (securite)." : ingest.error };
      }
      return {
        success: true, documentId: ingest.doc.id, fileName: built.fileName,
        downloadPath: `/api/documents/${ingest.doc.id}/download`,
      };
    },
  },
  {
    name: "create_pdf_document",
    description:
      "Cree un document PDF (.pdf) et l'enregistre dans la bibliotheque de documents (telechargeable). " +
      "Ideal pour rapports, lettres, devis et factures prets a envoyer. Le parametre dataJson est une chaine JSON " +
      "avec un titre optionnel et une liste de blocs (meme format que Word): " +
      "{\"title\":\"Facture\",\"blocks\":[{\"type\":\"heading\",\"text\":\"Detail\",\"level\":1}," +
      "{\"type\":\"paragraph\",\"text\":\"Texte...\"},{\"type\":\"table\",\"columns\":[\"Article\",\"Prix\"],\"rows\":[[\"Stylo\",\"5\"]]}]}.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Nom du fichier (ex: 'facture-001'). L'extension .pdf est ajoutee si absente." },
        dataJson: { type: "string", description: "Chaine JSON avec 'title' optionnel et 'blocks' (voir description)." },
      },
      required: ["fileName", "dataJson"],
    },
    fields: {
      fileName: { kind: "string", required: true, min: 1, max: 200 },
      dataJson: { kind: "string", required: true, min: 2, max: 200000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer un document PDF: « ${trim(a.fileName, 80)} »`,
    execute: async (a, { orgId, userId }) => {
      let spec: any;
      try {
        spec = JSON.parse(a.dataJson);
      } catch {
        return { success: false, error: "dataJson n'est pas un JSON valide." };
      }
      let built;
      try {
        built = await buildPdfBase64(spec, a.fileName);
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Specification PDF invalide." };
      }
      const ingest = await ingestDocument({
        orgId, userId: userId ?? null,
        fileContent: built.base64, fileName: built.fileName, mimeType: built.mimeType,
        category: "general", source: "assistant",
      });
      if (ingest.status !== "created") {
        return { success: false, error: ingest.status === "blocked" ? "Fichier bloque (securite)." : ingest.error };
      }
      return {
        success: true, documentId: ingest.doc.id, fileName: built.fileName,
        downloadPath: `/api/documents/${ingest.doc.id}/download`,
      };
    },
  },
  {
    name: "create_powerpoint_document",
    description:
      "Cree une presentation PowerPoint (.pptx) et l'enregistre dans la bibliotheque de documents (telechargeable). " +
      "Ideal pour presentations commerciales, comptes-rendus de reunion, supports de formation. Le parametre dataJson " +
      "est une chaine JSON avec un titre optionnel et une liste de diapositives. Chaque diapositive a un 'title' " +
      "et au choix 'bullets' (liste a puces), 'paragraphs' (texte) ou 'table' {columns, rows}. Exemple: " +
      "{\"title\":\"Offre 2026\",\"subtitle\":\"Agent de Bureau\",\"slides\":[" +
      "{\"title\":\"Avantages\",\"bullets\":[\"Gain de temps\",\"Moins d'erreurs\"]}," +
      "{\"title\":\"Tarifs\",\"table\":{\"columns\":[\"Offre\",\"Prix\"],\"rows\":[[\"Starter\",\"29€\"]]}}]}.",
    parameters: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Nom du fichier (ex: 'presentation-offre'). L'extension .pptx est ajoutee si absente." },
        dataJson: { type: "string", description: "Chaine JSON avec 'title'/'subtitle' optionnels et 'slides' (voir description)." },
      },
      required: ["fileName", "dataJson"],
    },
    fields: {
      fileName: { kind: "string", required: true, min: 1, max: 200 },
      dataJson: { kind: "string", required: true, min: 2, max: 200000 },
    },
    requiresConfirmation: true,
    summarize: (a) => `Creer une presentation PowerPoint: « ${trim(a.fileName, 80)} »`,
    execute: async (a, { orgId, userId }) => {
      let spec: any;
      try {
        spec = JSON.parse(a.dataJson);
      } catch {
        return { success: false, error: "dataJson n'est pas un JSON valide." };
      }
      let built;
      try {
        built = await buildPptxBase64(spec, a.fileName);
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : "Specification PowerPoint invalide." };
      }
      const ingest = await ingestDocument({
        orgId, userId: userId ?? null,
        fileContent: built.base64, fileName: built.fileName, mimeType: built.mimeType,
        category: "general", source: "assistant",
      });
      if (ingest.status !== "created") {
        return { success: false, error: ingest.status === "blocked" ? "Fichier bloque (securite)." : ingest.error };
      }
      return {
        success: true, documentId: ingest.doc.id, fileName: built.fileName,
        downloadPath: `/api/documents/${ingest.doc.id}/download`,
      };
    },
  },
  // ---------- INFO LOOKUP ----------
  {
    name: "list_recent_calls",
    description: "Liste les derniers appels (entrants / sortants).",
    parameters: { type: "object", properties: { limit: { type: "integer" } } },
    fields: F_LIMIT_ONLY,
    execute: async (a, { orgId }) => {
      const limit = a.limit ?? 10;
      const rows = await db.select({
        id: callsTable.id, direction: callsTable.direction, phoneNumber: callsTable.phoneNumber,
        contactName: callsTable.contactName, status: callsTable.status, duration: callsTable.duration,
        createdAt: callsTable.createdAt,
      }).from(callsTable).where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt)).limit(limit);
      return { count: rows.length, calls: rows };
    },
  },
  {
    name: "log_call",
    description:
      "Enregistre le resultat d'un appel existant: met a jour son statut et/ou ajoute des notes. " +
      "Statut valide: repondu (l'appel a abouti), manque (appel manque), messagerie (laisse sur la messagerie vocale). " +
      "Les notes fournies sont ajoutees a la suite des notes existantes (elles ne les remplacent pas). " +
      "Fournir l'id de l'appel et au moins un champ (status ou notes). NECESSITE UNE CONFIRMATION EXPLICITE.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID de l'appel a mettre a jour" },
        status: { type: "string", description: "repondu, manque, messagerie" },
        notes: { type: "string", description: "Notes a ajouter au compte-rendu de l'appel" },
      },
      required: ["id"],
    },
    fields: {
      id: { kind: "number", required: true, integer: true, min: 1 },
      status: { kind: "string", enum: ["repondu", "manque", "messagerie"] as const },
      notes: { kind: "string", max: 4000 },
    },
    requiresConfirmation: true,
    summarize: (a) => {
      const parts: string[] = [];
      if (a.status) parts.push(`statut → ${a.status}`);
      if (a.notes != null) parts.push(`note ajoutee: « ${trim(a.notes, 60)} »`);
      return `Enregistrer le resultat de l'appel #${a.id}${parts.length ? ` (${parts.join(", ")})` : ""}`;
    },
    execute: async (a, { orgId, userId }) => {
      if (a.status == null && a.notes == null) {
        return { success: false, error: "Aucune modification fournie (statut ou notes)." };
      }
      const [existing] = await db.select({ id: callsTable.id, notes: callsTable.notes })
        .from(callsTable)
        .where(and(eq(callsTable.id, a.id), eq(callsTable.organisationId, orgId)));
      if (!existing) return { success: false, error: "Appel introuvable dans votre organisation." };
      const updates: Record<string, unknown> = { updatedBy: userId };
      if (a.status != null) updates.status = a.status;
      if (a.notes != null) {
        const prev = (existing.notes ?? "").trim();
        updates.notes = prev ? `${prev}\n${a.notes}` : a.notes;
      }
      const [row] = await db.update(callsTable).set(updates)
        .where(and(eq(callsTable.id, a.id), eq(callsTable.organisationId, orgId)))
        .returning({ id: callsTable.id, status: callsTable.status });
      if (!row) return { success: false, error: "Appel introuvable dans votre organisation." };
      return { success: true, id: row.id, status: row.status, url: `/appels/${row.id}` };
    },
  },
  {
    name: "search_knowledge_base",
    description: "Recherche dans la base de connaissances (documents importes de l'organisation) les passages pertinents pour repondre a une question. Utilise-le quand l'utilisateur pose une question dont la reponse pourrait se trouver dans ses documents.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "La question ou les mots-cles a rechercher dans les documents" },
        limit: { type: "integer", description: "Nombre max d'extraits (1-10, defaut 6)" },
      },
      required: ["query"],
    },
    fields: {
      query: { kind: "string", required: true, min: 2, max: 500 },
      limit: { kind: "number", integer: true, min: 1, max: 10 },
    },
    execute: async (a, { orgId, userId }) => {
      const hits = await searchKnowledge(orgId, a.query as string, {
        topK: (a.limit as number) ?? 6,
        userId,
      });
      return {
        count: hits.length,
        extraits: hits.map((h) => ({
          document: h.fileName,
          documentId: h.documentId,
          pertinence: Number(h.score.toFixed(3)),
          contenu: trim(h.content, 600),
        })),
      };
    },
  },
  {
    name: "list_recent_messages",
    description: "Liste les derniers messages (notes, SMS, e-mails enregistres).",
    parameters: { type: "object", properties: { limit: { type: "integer" } } },
    fields: F_LIMIT_ONLY,
    execute: async (a, { orgId }) => {
      const limit = a.limit ?? 10;
      const rows = await db.select({
        id: messagesTable.id, type: messagesTable.type, phoneNumber: messagesTable.phoneNumber,
        contactName: messagesTable.contactName, content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      }).from(messagesTable).where(eq(messagesTable.organisationId, orgId)).orderBy(desc(messagesTable.createdAt)).limit(limit);
      return { count: rows.length, messages: rows.map(r => ({ ...r, content: trim(r.content, 200) })) };
    },
  },
];

const TOOL_MAP = new Map(ALL_TOOLS.map(t => [t.name, t] as const));

export function getAllTools(): ReadonlyArray<ToolDef<any>> { return ALL_TOOLS; }
export function getTool(name: string): ToolDef<unknown> | undefined { return TOOL_MAP.get(name); }

export interface ToolExecutionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  /** When the tool requires confirmation, no execution happens; engine
   *  must emit pending_action and wait for user approval. */
  pending?: { summary: string };
}

export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
  opts: { skipConfirmation?: boolean } = {},
): Promise<ToolExecutionResult> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: `Outil inconnu: ${name}` };

  // Validate args against the tool's field spec
  const parsed = validateArgs(tool.fields, rawArgs ?? {});
  if (!parsed.ok) {
    return { ok: false, error: `Argument invalide pour ${name}: ${parsed.error}` };
  }
  const args = parsed.data;

  // Confirmation gate for high-impact tools (server-enforced, NOT prompt-only)
  if (tool.requiresConfirmation && !opts.skipConfirmation) {
    const summary = tool.summarize ? tool.summarize(args) : `Confirmer l'execution de ${name}`;
    return { ok: false, pending: { summary } };
  }

  try {
    const result = await tool.execute(args, ctx);
    return { ok: true, result };
  } catch (err) {
    logger.error({ err, tool: name }, "[assistant] tool execution failed");
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: trim(msg, 500) };
  }
}

export function getGeminiToolDeclarations(): { functionDeclarations: Array<{ name: string; description: string; parameters: ToolDef["parameters"] }> } {
  return {
    functionDeclarations: ALL_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
}
