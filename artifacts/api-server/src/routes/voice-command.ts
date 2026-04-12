import { Router, type IRouter, type Request, type Response } from "express";
import { db, callsTable, contactsTable, tasksTable, facturesClientTable, prospectsTable, projetsTable, calendarEventsTable } from "@workspace/db";
import { eq, desc, and, sql, ilike, or } from "drizzle-orm";
import { getOrgId } from "../middleware/tenant";

const router: IRouter = Router();

interface VoiceCommand {
  intent: string;
  entity?: string;
  params?: Record<string, string>;
}

function parseCommand(text: string): VoiceCommand {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  if (t.match(/briefing|resume.*(jour|today)|quoi de neuf|resume/))
    return { intent: "daily_briefing" };

  if (t.match(/combien.*(appel|call)|nombre.*(appel|call)|appels.*aujourd/))
    return { intent: "count_calls" };

  if (t.match(/combien.*(tache|task)|nombre.*(tache|task)|taches.*(attente|pending)/))
    return { intent: "count_tasks" };

  if (t.match(/combien.*(contact)|nombre.*(contact)/))
    return { intent: "count_contacts" };

  if (t.match(/combien.*(facture|invoice)|factures.*(retard|impaye)/))
    return { intent: "invoice_status" };

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

  if (t.match(/prospect|pipeline|crm|lead/))
    return { intent: "prospects_summary" };

  if (t.match(/projet|project/))
    return { intent: "projects_summary" };

  if (t.match(/stock|inventaire/))
    return { intent: "stock_summary" };

  if (t.match(/performance|statistique|stats|kpi/))
    return { intent: "performance" };

  if (t.match(/aide|help|que peux.tu|commande/))
    return { intent: "help" };

  return { intent: "unknown", params: { text } };
}

router.post("/voice/command", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrgId(req);
  const { text, lang } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Texte requis" });
    return;
  }

  const command = parseCommand(text);
  let spokenResponse = "";
  let data: any = null;
  let action: string | null = null;
  let navigate: string | null = null;

  try {
    switch (command.intent) {
      case "daily_briefing": {
        const [calls, tasks, contacts, invoices, events] = await Promise.all([
          db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
            .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`)),
          db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
            .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente"))),
          db.select({ count: sql<number>`count(*)::int` }).from(contactsTable)
            .where(eq(contactsTable.organisationId, orgId)),
          db.select({ count: sql<number>`count(*)::int`, overdue: sql<number>`count(*) FILTER (WHERE status = 'envoyee' AND due_date < now())::int` })
            .from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId)),
          db.select({ count: sql<number>`count(*)::int` }).from(calendarEventsTable)
            .where(and(eq(calendarEventsTable.organisationId, orgId), sql`DATE(${calendarEventsTable.startDate}) = CURRENT_DATE`)),
        ]);
        const c = calls[0]?.count || 0;
        const t = tasks[0]?.count || 0;
        const ct = contacts[0]?.count || 0;
        const inv = invoices[0]?.overdue || 0;
        const ev = events[0]?.count || 0;
        spokenResponse = `Bonjour! Voici votre briefing du jour. Vous avez ${c} appel${c > 1 ? "s" : ""} aujourd'hui, ${t} tache${t > 1 ? "s" : ""} en attente, ${ct} contacts au total, ${inv} facture${inv > 1 ? "s" : ""} en retard, et ${ev} evenement${ev > 1 ? "s" : ""} au calendrier.`;
        data = { calls: c, tasks: t, contacts: ct, overdueInvoices: inv, events: ev };
        navigate = "/dashboard";
        break;
      }

      case "count_calls": {
        const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(callsTable)
          .where(and(eq(callsTable.organisationId, orgId), sql`DATE(${callsTable.createdAt}) = CURRENT_DATE`));
        const n = result?.count || 0;
        spokenResponse = `Vous avez ${n} appel${n > 1 ? "s" : ""} aujourd'hui.`;
        data = { count: n };
        navigate = "/calls";
        break;
      }

      case "count_tasks": {
        const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(tasksTable)
          .where(and(eq(tasksTable.organisationId, orgId), eq(tasksTable.status, "en_attente")));
        const n = result?.count || 0;
        spokenResponse = `Vous avez ${n} tache${n > 1 ? "s" : ""} en attente.`;
        data = { count: n };
        navigate = "/tasks";
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

      case "invoice_status": {
        const all = await db.select().from(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
        const total = all.length;
        const paid = all.filter(f => f.status === "payee").length;
        const overdue = all.filter(f => f.status === "envoyee" && f.dueDate && new Date(f.dueDate) < new Date()).length;
        const unpaid = all.reduce((s, f) => s + Number(f.totalAmount) - Number(f.paidAmount), 0);
        spokenResponse = `Vous avez ${total} facture${total > 1 ? "s" : ""} au total, dont ${paid} payee${paid > 1 ? "s" : ""} et ${overdue} en retard. Le montant impaye total est de ${Math.round(unpaid)} euros.`;
        data = { total, paid, overdue, unpaid: Math.round(unpaid) };
        navigate = "/invoices";
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
        navigate = "/calls";
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
        navigate = "/tasks";
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
        navigate = "/tasks";
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
        navigate = "/calendar";
        break;
      }

      case "prospects_summary": {
        const prospects = await db.select().from(prospectsTable)
          .where(eq(prospectsTable.organisationId, orgId));
        const total = prospects.length;
        const won = prospects.filter(p => p.stage === "gagne").length;
        const totalVal = prospects.reduce((s, p) => s + (Number(p.value) || 0), 0);
        spokenResponse = `Vous avez ${total} prospect${total > 1 ? "s" : ""} dans le pipeline, dont ${won} gagne${won > 1 ? "s" : ""}. La valeur totale est de ${Math.round(totalVal)} euros.`;
        data = { total, won, totalValue: Math.round(totalVal) };
        navigate = "/prospects";
        break;
      }

      case "projects_summary": {
        const projects = await db.select().from(projetsTable)
          .where(eq(projetsTable.organisationId, orgId));
        const total = projects.length;
        const active = projects.filter(p => p.status === "en_cours").length;
        const done = projects.filter(p => p.status === "termine").length;
        spokenResponse = `Vous avez ${total} projet${total > 1 ? "s" : ""}: ${active} en cours et ${done} termine${done > 1 ? "s" : ""}.`;
        data = { total, active, done };
        navigate = "/projects";
        break;
      }

      case "stock_summary": {
        const stockResult = await db.execute(sql`SELECT count(*)::int as total, coalesce(sum(CASE WHEN quantity <= min_quantity THEN 1 ELSE 0 END), 0)::int as low FROM stock_articles WHERE organisation_id = ${orgId}`);
        const stockRow = (stockResult as any).rows?.[0] || { total: 0, low: 0 };
        spokenResponse = `Vous avez ${stockRow.total} article${Number(stockRow.total) > 1 ? "s" : ""} en stock, dont ${stockRow.low} en alerte de stock bas.`;
        data = { total: Number(stockRow.total), lowStock: Number(stockRow.low) };
        navigate = "/stock";
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
        navigate = "/analytics";
        break;
      }

      case "help": {
        spokenResponse = "Vous pouvez me demander: le briefing du jour, compter vos appels ou taches, voir les factures en retard, creer une tache, appeler un contact, chercher dans vos donnees, consulter l'agenda, ou voir vos prospects et projets.";
        break;
      }

      default: {
        spokenResponse = `Je n'ai pas compris "${text}". Dites "aide" pour connaitre les commandes disponibles.`;
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
    console.error("[VoiceCommand] Error:", err);
    res.status(500).json({ success: false, spoken: "Une erreur est survenue. Veuillez reessayer." });
  }
});

router.get("/voice/commands", (_req: Request, res: Response): void => {
  res.json({
    commands: [
      { phrase: "Briefing du jour", description: "Resume complet de la journee" },
      { phrase: "Combien d'appels aujourd'hui", description: "Nombre d'appels du jour" },
      { phrase: "Taches en attente", description: "Nombre de taches en attente" },
      { phrase: "Factures en retard", description: "Statut des factures" },
      { phrase: "Derniers appels", description: "Les 5 derniers appels" },
      { phrase: "Taches urgentes", description: "Taches haute priorite" },
      { phrase: "Cree une tache [titre]", description: "Creer une nouvelle tache" },
      { phrase: "Appelle [nom]", description: "Trouver et appeler un contact" },
      { phrase: "Cherche [texte]", description: "Recherche dans contacts et taches" },
      { phrase: "Agenda du jour", description: "Evenements du calendrier" },
      { phrase: "Prospects / Pipeline", description: "Resume CRM" },
      { phrase: "Projets", description: "Resume des projets" },
      { phrase: "Performance", description: "Stats de la semaine" },
      { phrase: "Aide", description: "Liste des commandes" },
    ],
  });
});

export default router;
