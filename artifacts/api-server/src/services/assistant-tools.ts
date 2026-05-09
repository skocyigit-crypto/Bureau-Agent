import { db } from "@workspace/db";
import {
  contactsTable, tasksTable, prospectsTable, calendarEventsTable,
  callsTable, messagesTable, facturesClientTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, lte, sql, ilike, or } from "drizzle-orm";
import { sendEmail } from "./email";
import { sendSms as providerSendSms } from "./telephony-providers";
import { generateImage } from "@workspace/integrations-gemini-ai/image";
import { logger } from "../lib/logger";

export interface ToolContext {
  orgId: number;
  userId: number;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: any, ctx: ToolContext) => Promise<unknown>;
}

const trim = (s: unknown, n = 200): string => {
  const v = String(s ?? "");
  return v.length > n ? v.slice(0, n) + "…" : v;
};

const ALL_TOOLS: ToolDef[] = [
  {
    name: "get_current_datetime",
    description: "Retourne la date et l'heure actuelles (Europe/Paris).",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      iso: new Date().toISOString(),
      humanFr: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
    }),
  },
  {
    name: "get_dashboard_summary",
    description: "Resume rapide de l'activite (nb contacts, taches, prospects, factures impayees, appels du jour).",
    parameters: { type: "object", properties: {} },
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
    execute: async (a: { query?: string; limit?: number }, { orgId }) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 20), 1), 50);
      const conds = [eq(contactsTable.organisationId, orgId)];
      if (a.query) {
        const q = `%${a.query}%`;
        conds.push(or(
          ilike(contactsTable.firstName, q),
          ilike(contactsTable.lastName, q),
          ilike(contactsTable.company, q),
          ilike(contactsTable.email, q),
          ilike(contactsTable.phone, q),
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
    execute: async (a: any, { orgId, userId }) => {
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
  // ---------- TASKS ----------
  {
    name: "list_tasks",
    description: "Liste les taches, optionnellement filtrees par statut (en_attente, en_cours, terminee).",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "integer" },
      },
    },
    execute: async (a: any, { orgId }) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 20), 1), 50);
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
    execute: async (a: any, { orgId, userId }) => {
      const [row] = await db.insert(tasksTable).values({
        organisationId: orgId,
        title: a.title,
        description: a.description ?? null,
        priority: a.priority ?? "moyenne",
        dueDate: a.dueDate ? new Date(a.dueDate) : null,
        createdBy: userId,
      }).returning({ id: tasksTable.id });
      return { success: true, id: row.id, url: `/taches` };
    },
  },
  // ---------- PROSPECTS ----------
  {
    name: "list_prospects",
    description: "Liste les prospects, optionnellement filtres par etape (nouveau, qualifie, propose, gagne, perdu).",
    parameters: {
      type: "object",
      properties: { stage: { type: "string" }, limit: { type: "integer" } },
    },
    execute: async (a: any, { orgId }) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 20), 1), 50);
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
        stage: { type: "string", description: "nouveau, qualifie, propose, negociation, gagne, perdu" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
    execute: async (a: any, { orgId }) => {
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
  // ---------- CALENDAR ----------
  {
    name: "list_calendar_events",
    description: "Liste les evenements de l'agenda dans une fenetre. start/end en ISO. Defaut: 7 prochains jours.",
    parameters: {
      type: "object",
      properties: { start: { type: "string" }, end: { type: "string" } },
    },
    execute: async (a: any, { orgId }) => {
      const start = a.start ? new Date(a.start) : new Date();
      const end = a.end ? new Date(a.end) : new Date(Date.now() + 7 * 86400_000);
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
    execute: async (a: any, { orgId, userId }) => {
      const [row] = await db.insert(calendarEventsTable).values({
        organisationId: orgId,
        title: a.title,
        description: a.description ?? null,
        type: a.type ?? "rendez_vous",
        startDate: new Date(a.startDate),
        endDate: new Date(a.endDate),
        location: a.location ?? null,
        createdBy: userId,
      }).returning({ id: calendarEventsTable.id });
      return { success: true, id: row.id, url: "/calendrier" };
    },
  },
  // ---------- COMMS ----------
  {
    name: "send_email",
    description: "Envoie un e-mail. Utilisez du HTML simple ou du texte brut.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Adresse e-mail destinataire" },
        subject: { type: "string" },
        body: { type: "string", description: "Corps du message (texte ou HTML simple)" },
      },
      required: ["to", "subject", "body"],
    },
    execute: async (a: any) => {
      const html = /<\w+/.test(a.body) ? a.body : `<div style="font-family:system-ui">${a.body.replace(/\n/g, "<br>")}</div>`;
      const text = a.body.replace(/<[^>]+>/g, "");
      const r = await sendEmail(a.to, a.subject, html, text);
      return r;
    },
  },
  {
    name: "send_sms",
    description: "Envoie un SMS via Twilio (utilise les identifiants Twilio configures dans l'environnement).",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Numero international (+33...)" },
        message: { type: "string" },
      },
      required: ["to", "message"],
    },
    execute: async (a: any) => {
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
    execute: async (a: any) => {
      try {
        const img = await generateImage(a.prompt);
        return { success: true, dataUrl: `data:${img.mimeType};base64,${img.b64_json}` };
      } catch (e: any) {
        return { success: false, error: trim(e?.message) };
      }
    },
  },
  // ---------- INFO LOOKUP ----------
  {
    name: "list_recent_calls",
    description: "Liste les derniers appels (entrants / sortants).",
    parameters: { type: "object", properties: { limit: { type: "integer" } } },
    execute: async (a: any, { orgId }) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 10), 1), 50);
      const rows = await db.select({
        id: callsTable.id, direction: callsTable.direction, phoneNumber: callsTable.phoneNumber,
        contactName: callsTable.contactName, status: callsTable.status, duration: callsTable.duration,
        createdAt: callsTable.createdAt,
      }).from(callsTable).where(eq(callsTable.organisationId, orgId)).orderBy(desc(callsTable.createdAt)).limit(limit);
      return { count: rows.length, calls: rows };
    },
  },
  {
    name: "list_recent_messages",
    description: "Liste les derniers messages (SMS/whatsapp/email entrants ou sortants).",
    parameters: { type: "object", properties: { limit: { type: "integer" } } },
    execute: async (a: any, { orgId }) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 10), 1), 50);
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

export function getAllTools(): ToolDef[] { return ALL_TOOLS; }

export async function executeTool(name: string, args: any, ctx: ToolContext): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: `Outil inconnu: ${name}` };
  try {
    const result = await tool.execute(args ?? {}, ctx);
    return { ok: true, result };
  } catch (err: any) {
    logger.error({ err, tool: name, args }, "[assistant] tool execution failed");
    return { ok: false, error: trim(err?.message ?? "Erreur interne", 500) };
  }
}

export function getGeminiToolDeclarations(): { functionDeclarations: any[] } {
  return {
    functionDeclarations: ALL_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
}
