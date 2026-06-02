import { db, callsTable, tasksTable, calendarEventsTable, notificationsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logAudit } from "../routes/audit";
import { safeJsonParse, aiCallWithRetry, sanitizePromptInput, recordAiUsage, extractGeminiTokens, geminiActualModel, GEMINI_PRO_MODEL } from "./ai-utils";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import { logger } from "../lib/logger";

const CALL_LOCK_NAMESPACE = 4242;

interface CallAnalysis {
  summary: string;
  sentiment: string;
  emotion?: string;
  urgency?: string;
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

  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${CALL_LOCK_NAMESPACE}, ${callId}) AS acquired`
  );
  const acquired = (lockResult as any).rows?.[0]?.acquired ?? (lockResult as any)[0]?.acquired;
  if (!acquired) {
    throw new Error("Cet appel est deja en cours de traitement par une autre instance.");
  }

  processingCalls.add(callId);
  try {
    return await _processCallInternal(callId);
  } finally {
    processingCalls.delete(callId);
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${CALL_LOCK_NAMESPACE}, ${callId})`);
    } catch (unlockErr) {
      logger.error({ err: unlockErr }, `[call-processor] Failed to release advisory lock for call ${callId}:`);
    }
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

  await assertAiQuota(call.organisationId);

  const { ai } = await import("@workspace/integrations-gemini-ai");

  const prompt = `Tu es l'analyste IA d'elite du bureau professionnel "Agent de Bureau" en France.
Tu possedes une expertise avancee en analyse conversationnelle, detection de patterns et intelligence d'affaires.

APPEL A ANALYSER EN PROFONDEUR:
- Contact: ${sanitizePromptInput(call.contactName, 200) || "Inconnu"}
- Telephone: ${sanitizePromptInput(call.phoneNumber, 50)}
- Direction: ${call.direction}
- Statut: ${call.status}
- Duree: ${call.duration} secondes
- Notes/Transcription: ${sanitizePromptInput(call.notes, 6000) || "Aucune note"}
- Date: ${call.createdAt}

ANALYSE MULTI-DIMENSIONNELLE:
1. Resume l'appel en 2-3 phrases percutantes et actionnables.
2. Determine le sentiment global sur 5 niveaux:
   - "tres_positif": client enthousiaste, satisfaction elevee, recommandation probable
   - "positif": client content, interaction reussie
   - "neutre": echange standard sans emotion marquee
   - "negatif": client mecontent, frustration, plainte
   - "tres_negatif": client en colere, menace de resiliation, urgence critique
2bis. Detecte l'emotion dominante: "satisfaction", "enthousiasme", "calme", "interrogation", "frustration", "colere", "tristesse", "anxiete".
2ter. Determine le niveau d'urgence: "faible", "moyenne", "haute", "critique".
3. Detecte si un rendez-vous a ete demande ou convenu.
   - Si oui, propose une date/heure realiste (prochains jours ouvrables, 9h-18h, pas de jours feries).
   - Determine le type: rdv, visite, reunion, appel.
4. Identifie TOUTES les taches a creer suite a cet appel.
   - Pour chaque tache: titre precis, description detaillee, priorite (haute/moyenne/basse), delai en jours.
   - Inclus les taches implicites (ex: si le client mentionne un probleme, cree une tache de suivi).
5. Determine si un suivi est necessaire et pourquoi.
6. Propose des tags pertinents et precis (minimum 3).
7. Genere une petite blague legere et professionnelle en rapport avec le sujet de l'appel.
   - Courte (1-2 phrases max), bienveillante et adaptee au milieu professionnel.
   - Adapte la blague au contexte (comptabilite, rendez-vous, devis, chantier, etc.)

IMPORTANT:
- Les dates suggerees doivent etre au format ISO 8601 (YYYY-MM-DD).
- Les heures au format HH:MM.
- La duree du rendez-vous en minutes.
- Toujours en francais.

Reponds UNIQUEMENT en JSON avec cette structure:
{
  "summary": "string",
  "sentiment": "tres_positif|positif|neutre|negatif|tres_negatif",
  "emotion": "satisfaction|enthousiasme|calme|interrogation|frustration|colere|tristesse|anxiete",
  "urgency": "faible|moyenne|haute|critique",
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

  const aiStart = Date.now();
  let response: any;
  try {
    response = await aiCallWithRetry(
      () => ai.models.generateContent({
        model: GEMINI_PRO_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 1024 },
        },
      }),
      { label: `call-processor#${callId}`, maxRetries: 2 }
    );
  } catch (aiErr: any) {
    await recordAiUsage({
      organisationId: call.organisationId,
      provider: "gemini",
      model: GEMINI_PRO_MODEL,
      route: "call-processor",
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - aiStart,
      status: "error",
      errorMessage: aiErr?.name ? `${aiErr.name}: ${aiErr?.message || ""}` : String(aiErr?.message || aiErr),
    });
    throw aiErr;
  }
  const tokens = extractGeminiTokens(response);
  await recordAiUsage({
    organisationId: call.organisationId,
    provider: "gemini",
    model: geminiActualModel(response, GEMINI_PRO_MODEL),
    route: "call-processor",
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs: Date.now() - aiStart,
    status: "success",
  });
  if (call.organisationId) invalidateQuotaCache(call.organisationId);

  const fallback: CallAnalysis = {
    summary: "Analyse non disponible",
    sentiment: "neutre",
    emotion: "calme",
    urgency: "faible",
    appointmentRequested: false,
    appointment: null,
    tasks: [],
    followUpNeeded: false,
    followUpReason: null,
    tags: [],
    joke: null,
  };
  const parsed = safeJsonParse<Partial<CallAnalysis>>(response.text, fallback);
  const allowedSentiments = new Set(["tres_positif", "positif", "neutre", "negatif", "tres_negatif"]);
  const allowedUrgencies = new Set(["faible", "moyenne", "haute", "critique"]);
  const allowedPriorities = new Set(["haute", "moyenne", "basse"]);
  const analysis: CallAnalysis = {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : fallback.summary,
    sentiment: allowedSentiments.has(parsed.sentiment as string) ? (parsed.sentiment as string) : "neutre",
    emotion: typeof parsed.emotion === "string" ? parsed.emotion : "calme",
    urgency: allowedUrgencies.has(parsed.urgency as string) ? (parsed.urgency as string) : "faible",
    appointmentRequested: !!parsed.appointmentRequested,
    appointment: parsed.appointment && typeof parsed.appointment === "object" ? parsed.appointment as CallAnalysis["appointment"] : null,
    tasks: Array.isArray(parsed.tasks)
      ? parsed.tasks.filter((t: any) => t && typeof t.title === "string").slice(0, 20).map((t: any) => ({
          title: String(t.title).slice(0, 200),
          description: typeof t.description === "string" ? t.description.slice(0, 1000) : "",
          priority: allowedPriorities.has(t.priority) ? t.priority : "moyenne",
          dueInDays: Number.isFinite(t.dueInDays) ? Math.max(0, Math.min(90, Number(t.dueInDays))) : 1,
        }))
      : [],
    followUpNeeded: !!parsed.followUpNeeded,
    followUpReason: typeof parsed.followUpReason === "string" ? parsed.followUpReason.slice(0, 500) : null,
    tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: any) => typeof t === "string").slice(0, 15) : [],
    joke: typeof parsed.joke === "string" ? parsed.joke.slice(0, 500) : null,
  };

  const enrichedTags = [...(analysis.tags || [])];
  if (analysis.emotion) enrichedTags.push(`emotion:${analysis.emotion}`);
  if (analysis.urgency && analysis.urgency !== "faible") enrichedTags.push(`urgence:${analysis.urgency}`);

  await db.update(callsTable).set({
    sentiment: analysis.sentiment,
    tags: enrichedTags.length > 0 ? enrichedTags : call.tags,
  }).where(eq(callsTable.id, callId));

  const createdTasks: any[] = [];
  for (const taskDef of analysis.tasks) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (taskDef.dueInDays || 1));

    const [task] = await db.insert(tasksTable).values({
      organisationId: call.organisationId!,
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
      organisationId: call.organisationId!,
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
  }, undefined, undefined, call.organisationId ?? null);

  return { analysis, createdTasks, createdAppointment };
}
