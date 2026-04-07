import { db, callsTable, tasksTable, calendarEventsTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logAudit } from "../routes/audit";

interface CallAnalysis {
  summary: string;
  sentiment: string;
  appointmentRequested: boolean;
  appointment: {
    title: string;
    description: string;
    suggestedDate: string;
    suggestedTime: string;
    duration: number;
    location: string | null;
    type: string;
  } | null;
  tasks: Array<{
    title: string;
    description: string;
    priority: string;
    dueInDays: number;
  }>;
  followUpNeeded: boolean;
  followUpReason: string | null;
  tags: string[];
  joke: string | null;
}

const processingCalls = new Set<number>();

export async function processCallWithAI(callId: number): Promise<{
  analysis: CallAnalysis;
  createdTasks: any[];
  createdAppointment: any | null;
}> {
  if (processingCalls.has(callId)) {
    throw new Error("Cet appel est deja en cours de traitement.");
  }
  processingCalls.add(callId);

  try {
    return await _processCallInternal(callId);
  } finally {
    processingCalls.delete(callId);
  }
}

async function _processCallInternal(callId: number): Promise<{
  analysis: CallAnalysis;
  createdTasks: any[];
  createdAppointment: any | null;
}> {
  const [call] = await db.select().from(callsTable).where(eq(callsTable.id, callId));
  if (!call) throw new Error("Appel non trouve");

  if (call.sentiment && call.sentiment !== "neutre") {
    throw new Error("Cet appel a deja ete traite par l'IA.");
  }
  const existingTasks = await db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.relatedCallId, callId)).limit(1);
  if (existingTasks.length > 0) {
    throw new Error("Cet appel a deja ete traite par l'IA.");
  }

  const { ai } = await import("@workspace/integrations-gemini-ai");

  const prompt = `Tu es l'assistant intelligent d'un bureau professionnel en France (Agent de Bureau).
Tu analyses les appels telephoniques et extrais automatiquement les actions necessaires.

APPEL A ANALYSER:
- Contact: ${call.contactName || "Inconnu"}
- Telephone: ${call.phoneNumber}
- Direction: ${call.direction}
- Statut: ${call.status}
- Duree: ${call.duration} secondes
- Notes: ${call.notes || "Aucune note"}
- Date: ${call.createdAt}

INSTRUCTIONS:
1. Resume l'appel en 2-3 phrases.
2. Determine le sentiment global (positif, neutre, negatif).
3. Detecte si un rendez-vous a ete demande ou convenu.
   - Si oui, propose une date/heure realiste (dans les prochains jours ouvrables).
   - Determine le type: rdv, visite, reunion, appel.
4. Identifie les taches a creer suite a cet appel.
   - Pour chaque tache, donne un titre, description, priorite (haute/moyenne/basse), et delai en jours.
5. Determine si un suivi est necessaire.
6. Propose des tags pertinents.
7. Genere une petite blague legere et professionnelle en rapport avec le sujet de l'appel.
   - La blague doit etre courte (1-2 phrases max), bienveillante et adaptee au milieu professionnel.
   - Elle peut etre un jeu de mots, une observation amusante, ou un trait d'humour leger.
   - Exemples: "Pourquoi les comptables ne jouent jamais a cache-cache? Parce qu'ils finissent toujours par se faire retrouver dans les comptes!", "Un devis bien fait, c'est comme un bon cafe: ca reveille tout le monde!"
   - Adapte la blague au contexte de l'appel (comptabilite, rendez-vous, devis, chantier, etc.)
   - Toujours en francais, toujours respectueuse et legere.

IMPORTANT:
- Les dates suggerees doivent etre au format ISO 8601 (YYYY-MM-DD).
- Les heures au format HH:MM.
- La duree du rendez-vous en minutes.
- Toujours en francais.

Reponds UNIQUEMENT en JSON avec cette structure:
{
  "summary": "string",
  "sentiment": "positif|neutre|negatif",
  "appointmentRequested": boolean,
  "appointment": {
    "title": "string",
    "description": "string",
    "suggestedDate": "YYYY-MM-DD",
    "suggestedTime": "HH:MM",
    "duration": number,
    "location": "string|null",
    "type": "rdv|visite|reunion|appel"
  } | null,
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "priority": "haute|moyenne|basse",
      "dueInDays": number
    }
  ],
  "followUpNeeded": boolean,
  "followUpReason": "string|null",
  "tags": ["string"],
  "joke": "string"
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  const text = response.text ?? "{}";
  let analysis: CallAnalysis;
  try {
    analysis = JSON.parse(text);
  } catch {
    analysis = {
      summary: "Analyse non disponible",
      sentiment: "neutre",
      appointmentRequested: false,
      appointment: null,
      tasks: [],
      followUpNeeded: false,
      followUpReason: null,
      tags: [],
      joke: null,
    };
  }

  await db.update(callsTable).set({
    sentiment: analysis.sentiment,
    tags: analysis.tags.length > 0 ? analysis.tags : call.tags,
  }).where(eq(callsTable.id, callId));

  const createdTasks: any[] = [];
  for (const taskDef of analysis.tasks) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (taskDef.dueInDays || 1));

    const [task] = await db.insert(tasksTable).values({
      title: taskDef.title,
      description: `${taskDef.description}\n\n[Cree automatiquement - Appel #${callId} avec ${call.contactName || call.phoneNumber}]`,
      status: "en_attente",
      priority: taskDef.priority || "moyenne",
      dueDate,
      relatedCallId: callId,
      relatedContactId: call.contactId,
    }).returning();

    createdTasks.push(task);
  }

  if (analysis.followUpNeeded) {
    const followUpDue = new Date();
    followUpDue.setDate(followUpDue.getDate() + 1);

    const [followUpTask] = await db.insert(tasksTable).values({
      title: `Suivi: ${call.contactName || call.phoneNumber}`,
      description: `${analysis.followUpReason || "Suivi necessaire suite a l'appel."}\n\n[Cree automatiquement - Appel #${callId}]`,
      status: "en_attente",
      priority: "haute",
      dueDate: followUpDue,
      relatedCallId: callId,
      relatedContactId: call.contactId,
    }).returning();

    createdTasks.push(followUpTask);
  }

  let createdAppointment = null;
  if (analysis.appointmentRequested && analysis.appointment) {
    const apt = analysis.appointment;
    const startDate = new Date(`${apt.suggestedDate}T${apt.suggestedTime}:00`);
    if (isNaN(startDate.getTime())) {
      startDate.setDate(startDate.getDate() + 2);
      startDate.setHours(10, 0, 0, 0);
    }
    const endDate = new Date(startDate.getTime() + (apt.duration || 60) * 60000);

    const typeColorMap: Record<string, string> = {
      rdv: "#3b82f6",
      visite: "#22c55e",
      reunion: "#8b5cf6",
      appel: "#f59e0b",
    };

    const [event] = await db.insert(calendarEventsTable).values({
      title: apt.title,
      description: `${apt.description}\n\n[Cree automatiquement - Appel #${callId} avec ${call.contactName || call.phoneNumber}]`,
      type: apt.type === "visite" ? "rendez_vous" : apt.type === "reunion" ? "reunion" : apt.type === "appel" ? "appel" : "rendez_vous",
      startDate,
      endDate,
      location: apt.location || null,
      color: typeColorMap[apt.type] || "#3b82f6",
      relatedContactId: call.contactId,
    }).returning();

    createdAppointment = event;

    await db.insert(notificationsTable).values({
      type: "info",
      title: "Rendez-vous cree automatiquement",
      message: `"${apt.title}" le ${startDate.toLocaleDateString("fr-FR")} a ${startDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}${apt.location ? ` - ${apt.location}` : ""}. Cree suite a l'appel avec ${call.contactName || call.phoneNumber}.`,
      priority: "haute",
      actionUrl: "/calendrier",
      sourceType: "auto_appointment",
      sourceId: String(event.id),
    });
  }

  if (createdTasks.length > 0) {
    await db.insert(notificationsTable).values({
      type: "info",
      title: `${createdTasks.length} tache(s) creee(s) automatiquement`,
      message: `Suite a l'appel avec ${call.contactName || call.phoneNumber}: ${createdTasks.map(t => t.title).join(", ")}.`,
      priority: "normale",
      actionUrl: "/taches",
      sourceType: "auto_tasks",
      sourceId: String(callId),
    });
  }

  logAudit(undefined, "systeme", "ai_process_call", "call", String(callId), {
    tasksCreated: createdTasks.length,
    appointmentCreated: !!createdAppointment,
    sentiment: analysis.sentiment,
  });

  return { analysis, createdTasks, createdAppointment };
}
