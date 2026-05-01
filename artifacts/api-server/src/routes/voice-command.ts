import { Router, type IRouter, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, calendarEventsTable } from "@workspace/db";
import { eq, desc, and, sql, ilike, or } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";
import { safeJsonParse, aiCallWithRetry, sanitizePromptInput } from "../services/ai-utils";
import { assertAiQuota, AiQuotaExceededError } from "../services/ai-quota";
import { logger } from "../lib/logger";

let ai: any = null;
try {
  const mod = require("@workspace/integrations-gemini-ai");
  ai = mod.ai;
} catch (e) { logger.warn({ err: e }, "[VoiceCommand] Gemini AI not available:"); }

const router: IRouter = Router();

interface VoiceCommand {
  intent: string;
  entity?: string;
  params?: Record<string, string>;
}

function parseCommandRegex(text: string): VoiceCommand {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (t.match(/briefing|resume.*(jour|today)|quoi de neuf|resume/))
    return { intent: "daily_briefing" };
  if (t.match(/combien.*(appel|call)|nombre.*(appel|call)|appels.*aujourd/))
    return { intent: "count_calls" };
  if (t.match(/combien.*(tache|task)|nombre.*(tache|task)|taches.*(attente|pending)/))
    return { intent: "count_tasks" };
  if (t.match(/combien.*(contact)|nombre.*(contact)/))
    return { intent: "count_contacts" };
  if (t.match(/derniers? appels?|appels? recents?|recent.*call/))
    return { intent: "recent_calls" };
  if (t.match(/taches? urgente|taches? haute|taches? priorite|urgent.*task/))
    return { intent: "urgent_tasks" };
  if (t.match(/cre(e|er).*tache|nouvelle? tache|ajoute.*tache|new.*task/)) {
    const titleMatch = text.match(/(?:tache|task)\s+(.+)/i);
    return { intent: "create_task", params: { title: titleMatch?.[1] || "Nouvelle tache" } };
  }
  if (t.match(/appel(le|er)?\s|telephone|call\s/)) {
    const nameMatch = text.match(/(?:appelle|appeler|call)\s+(.+)/i);
    return { intent: "call_contact", params: { name: nameMatch?.[1] || "" } };
  }
  if (t.match(/cherche|recherche|trouve|search|find/)) {
    const queryMatch = text.match(/(?:cherche|recherche|trouve|search|find)\s+(.+)/i);
    return { intent: "search", params: { query: queryMatch?.[1] || "" } };
  }
  if (t.match(/agenda|rendez.?vous|rdv|calendrier|calendar|evenement/))
    return { intent: "calendar" };
  if (t.match(/performance|statistique|stats|kpi/))
    return { intent: "performance" };
  if (t.match(/aide|help|que peux.tu|commande/))
    return { intent: "help" };
  if (t.match(/bonjour|salut|coucou|bonsoir|hello|hi/))
    return { intent: "greeting" };
  if (t.match(/heure|quelle heure|time/))
    return { intent: "time" };
  if (t.match(/merci|thank/))
    return { intent: "thanks" };

  return { intent: "unknown", params: { text } };
}

async function parseCommandAI(text: string): Promise<VoiceCommand> {
  if (!ai) return parseCommandRegex(text);

  const safeText = sanitizePromptInput(text, 1000);
  try {
    const result = await aiCallWithRetry(() => ai!.models.generateContent({
      model: "gemini-2.5-flash-preview-05-20",
      contents: [{
        role: "user",
        parts: [{ text: `Tu es un assistant vocal pour un logiciel de gestion de bureau en francais.
Analyse cette commande vocale et retourne un JSON avec "intent" et "params".

Intents possibles:
- daily_briefing: resume de la journee
- count_calls: combien d'appels
- count_tasks: combien de taches
- count_contacts: combien de contacts
- recent_calls: derniers appels
- urgent_tasks: taches urgentes/haute priorite
- create_task: creer une tache (params: {title: "..."})
- call_contact: appeler un contact (params: {name: "..."})
- search: rechercher (params: {query: "..."})
- calendar: agenda/evenements du jour
- performance: stats de la semaine
- greeting: salutation
- time: quelle heure
- thanks: remerciement
- help: aide/commandes
- unknown: si non reconnu

Commande: "${safeText}"

Reponds UNIQUEMENT en JSON valide, sans backticks ni explication. Exemple: {"intent":"create_task","params":{"title":"Rappeler le client"}}` }]
      }],
    }), { label: "voice-command", maxRetries: 1 });

    const parsed = safeJsonParse<VoiceCommand>((result as any).text, { intent: "unknown", params: { text } });
    if (parsed.intent) return parsed;
  } catch (err) {
    logger.warn({ err: err }, "[VoiceCommand] AI parse fallback:");
  }

  return parseCommandRegex(text);
}

router.post("/voice/command", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { text } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Texte requis" });
    return;
  }

  try { await assertAiQuota(orgId); } catch (qe) {
    if (qe instanceof AiQuotaExceededError) { res.status(429).json({ error: qe.message, quotaExceeded: true }); return; }
    throw qe;
  }

  const command = await parseCommandAI(text);
  let spokenResponse = "";
  let data: any = null;
  let action: string | null = null;
  let navigate: string | null = null;

  try {
    switch (command.intent) {
      case "daily_briefing": {
        const [calls, tasks, contacts, events] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
            .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`)),
          db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
            .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente"))),
          db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
            .where(eq(contactsTable.organisationId, orgId)),
          db.select({ count: sql<number>`count(*)::int` }).from(calendarEventsTable)
            .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`)),
        ]);
        const c = calls[0]?.count || 0;
        const t = tasks[0]?.count || 0;
        const ct = contacts[0]?.count || 0;
        const ev = events[0]?.count || 0;
        spokenResponse = `Bonjour! Voici votre briefing du jour. Vous avez ${c} appel${c > 1 ? "s" : ""} aujourd'hui, ${t} tache${t > 1 ? "s" : ""} en attente, ${ct} contact${ct > 1 ? "s" : ""} au total, et ${ev} evenement${ev > 1 ? "s" : ""} au calendrier.`;
        data = { calls: c, tasks: t, contacts: ct, events: ev };
        navigate = "/";
        break;
      }

      case "count_calls": {
        const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
          .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`));
        const n = result?.count || 0;
        spokenResponse = `Vous avez ${n} appel${n > 1 ? "s" : ""} aujourd'hui.`;
        data = { count: n };
        navigate = "/appels";
        break;
      }

      case "count_tasks": {
        const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente")));
        const n = result?.count || 0;
        spokenResponse = `Vous avez ${n} tache${n > 1 ? "s" : ""} en attente.`;
        data = { count: n };
        navigate = "/taches";
        break;
      }

      case "count_contacts": {
        const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
          .where(eq(contactsTable.organisationId, orgId));
        const n = result?.count || 0;
        spokenResponse = `Vous avez ${n} contact${n > 1 ? "s" : ""} au total.`;
        data = { count: n };
        navigate = "/contacts";
        break;
      }

      case "recent_calls": {
        const calls = await db.select().from(callsTable)
          .where(eq(callsTable.organisationId, orgId))
          .orderBy(desc(callsTable.createdAt)).limit(5);
        const names = calls.map(c => c.contactName || c.phoneNumber).join(", ");
        spokenResponse = calls.length > 0
          ? `Vos ${calls.length} derniers appels: ${names}.`
          : "Aucun appel recent.";
        data = { calls: calls.map(c => ({ name: c.contactName, phone: c.phoneNumber, status: c.status })) };
        navigate = "/appels";
        break;
      }

      case "urgent_tasks": {
        const tasks = await db.select().from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.priority, "haute"), eq(tasksTable.status, "en_attente")))
          .orderBy(desc(tasksTable.createdAt)).limit(5);
        const titles = tasks.map(t => t.title).join(", ");
        spokenResponse = tasks.length > 0
          ? `Vous avez ${tasks.length} tache${tasks.length > 1 ? "s" : ""} urgente${tasks.length > 1 ? "s" : ""}: ${titles}.`
          : "Aucune tache urgente en attente.";
        data = { tasks: tasks.map(t => ({ id: t.id, title: t.title })) };
        navigate = "/taches";
        break;
      }

      case "create_task": {
        const title = command.params?.title || "Nouvelle tache vocale";
        await db.insert(tasksTable).values({
          organisationId: orgId,
          title,
          description: `Cree par commande vocale: "${text}"`,
          status: "en_attente",
          priority: "moyenne",
        });
        spokenResponse = `La tache "${title}" a ete creee avec succes.`;
        action = "task_created";
        navigate = "/taches";
        break;
      }

      case "call_contact": {
        const name = command.params?.name || "";
        if (!name) {
          spokenResponse = "Quel contact souhaitez-vous appeler?";
          break;
        }
        const [contact] = await db.select().from(contactsTable)
          .where(and(
            eq(contactsTable.organisationId, orgId),
            or(
              ilike(contactsTable.firstName, `%${name}%`),
              ilike(contactsTable.lastName, `%${name}%`)
            )
          )).limit(1);
        if (contact && contact.phone) {
          spokenResponse = `J'ai trouve ${contact.firstName} ${contact.lastName}. Son numero est ${contact.phone}. Lancement de l'appel.`;
          data = { contact: { name: `${contact.firstName} ${contact.lastName}`, phone: contact.phone } };
          action = "initiate_call";
        } else {
          spokenResponse = `Je n'ai pas trouve de contact nomme ${name}.`;
        }
        break;
      }

      case "search": {
        const query = command.params?.query || "";
        if (!query) {
          spokenResponse = "Que souhaitez-vous rechercher?";
          break;
        }
        const [contacts, tasks] = await Promise.all([
          db.select().from(contactsTable)
            .where(and(eq(contactsTable.organisationId, orgId), or(
              ilike(contactsTable.firstName, `%${query}%`),
              ilike(contactsTable.lastName, `%${query}%`),
              ilike(contactsTable.company, `%${query}%`)
            ))).limit(3),
          db.select().from(tasksTable)
            .where(and(eq(tasksTable.organisationId, orgId), ilike(tasksTable.title, `%${query}%`))).limit(3),
        ]);
        const total = contacts.length + tasks.length;
        spokenResponse = total > 0
          ? `J'ai trouve ${total} resultat${total > 1 ? "s" : ""}: ${contacts.length} contact${contacts.length > 1 ? "s" : ""} et ${tasks.length} tache${tasks.length > 1 ? "s" : ""}.`
          : `Aucun resultat pour "${query}".`;
        data = { contacts: contacts.map(c => `${c.firstName} ${c.lastName}`), tasks: tasks.map(t => t.title) };
        break;
      }

      case "calendar": {
        const events = await db.select().from(calendarEventsTable)
          .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`))
          .orderBy(calendarEventsTable.startDate).limit(5);
        if (events.length > 0) {
          const evList = events.map(e => e.title).join(", ");
          spokenResponse = `Vous avez ${events.length} evenement${events.length > 1 ? "s" : ""} aujourd'hui: ${evList}.`;
        } else {
          spokenResponse = "Aucun evenement prevu aujourd'hui.";
        }
        data = { events: events.map(e => ({ title: e.title, time: e.startDate })) };
        navigate = "/calendrier";
        break;
      }

      case "performance": {
        const [calls, tasks] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
            .where(and(eq(callsTable.organisationId, orgId), sql`${callsTable.createdAt} >= now() - interval '7 days'`)),
          db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
            .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "termine"), sql`${tasksTable.updatedAt} >= now() - interval '7 days'`)),
        ]);
        spokenResponse = `Cette semaine: ${calls[0]?.count || 0} appels passes et ${tasks[0]?.count || 0} taches terminees.`;
        data = { weekCalls: calls[0]?.count || 0, weekTasksDone: tasks[0]?.count || 0 };
        navigate = "/analyse";
        break;
      }

      case "greeting": {
        const hour = new Date().getHours();
        const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon apres-midi" : "Bonsoir";
        spokenResponse = `${greeting}! Comment puis-je vous aider?`;
        break;
      }

      case "time": {
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        spokenResponse = `Il est ${h} heure${h > 1 ? "s" : ""} ${m > 0 ? `et ${m} minute${m > 1 ? "s" : ""}` : ""}.`;
        break;
      }

      case "thanks": {
        spokenResponse = "Je vous en prie! N'hesitez pas si vous avez besoin d'autre chose.";
        break;
      }

      case "help": {
        spokenResponse = "Vous pouvez me demander: le briefing du jour, compter vos appels ou taches, voir les taches urgentes, creer une tache, appeler un contact, chercher dans vos donnees, ou consulter l'agenda.";
        break;
      }

      default: {
        if (ai) {
          try {
            const result = await ai.models.generateContent({
              model: "gemini-2.5-flash-preview-05-20",
              contents: [{
                role: "user",
                parts: [{ text: `Tu es l'assistant vocal "Bureau" d'un logiciel de gestion de bureau francais. L'utilisateur a dit: "${text}". Reponds de maniere concise, utile et naturelle en francais (2-3 phrases max). Si c'est hors sujet, propose poliment les fonctionnalites disponibles (appels, taches, contacts, calendrier, performance).` }]
              }],
            });
            spokenResponse = (result.text || "").trim() || `Je n'ai pas compris "${text}". Dites "aide" pour connaitre les commandes.`;
          } catch {
            spokenResponse = `Je n'ai pas compris "${text}". Dites "aide" pour connaitre les commandes disponibles.`;
          }
        } else {
          spokenResponse = `Je n'ai pas compris "${text}". Dites "aide" pour connaitre les commandes disponibles.`;
        }
        break;
      }
    }

    res.json({
      success: true,
      intent: command.intent,
      spoken: spokenResponse,
      data,
      action,
      navigate,
    });
  } catch (err) {
    logger.error({ err: err }, "[VoiceCommand] Error:");
    res.status(500).json({ success: false, spoken: "Une erreur est survenue. Veuillez reessayer." });
  }
});

router.get("/voice/commands", (_req: Request, res: Response): void => {
  res.json({
    commands: [
      { phrase: "Briefing du jour", description: "Resume complet de la journee" },
      { phrase: "Combien d'appels aujourd'hui", description: "Nombre d'appels du jour" },
      { phrase: "Taches en attente", description: "Nombre de taches en attente" },
      { phrase: "Derniers appels", description: "Les 5 derniers appels" },
      { phrase: "Taches urgentes", description: "Taches haute priorite" },
      { phrase: "Cree une tache [titre]", description: "Creer une nouvelle tache" },
      { phrase: "Appelle [nom]", description: "Trouver et appeler un contact" },
      { phrase: "Cherche [texte]", description: "Recherche dans contacts et taches" },
      { phrase: "Agenda du jour", description: "Evenements du calendrier" },
      { phrase: "Performance", description: "Stats de la semaine" },
      { phrase: "Quelle heure est-il", description: "Heure actuelle" },
      { phrase: "Aide", description: "Liste des commandes" },
    ],
  });
});

export default router;
