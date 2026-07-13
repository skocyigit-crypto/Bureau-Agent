/**
 * Boîte e-mail autonome (Tâche #290) — "secrétaire e-mail" qui travaille seule.
 *
 * En arrière-plan, pour chaque organisation ayant activé l'autonomie proactive
 * (organisations.proactiveEngineEnabled) ET disposant d'un utilisateur ayant
 * connecté sa boîte Gmail, ce service :
 *   1. récupère un échantillon récent de la boîte de réception (lecture seule) ;
 *   2. trie/classe les e-mails par IA (triage : priorité, catégorie, needsReply) ;
 *   3. pour chaque e-mail CRITIQUE/HAUTE nécessitant une réponse, crée une
 *      SUGGESTION proactive (`email_reply_needed`) avec un BROUILLON de réponse
 *      pré-rédigé, déposé dans la file d'approbation (actionPayload) ;
 *   4. auto-résout les suggestions dont l'e-mail n'attend plus de réponse
 *      (répondu / sorti de la fenêtre de scan).
 *
 * RÈGLE D'OR : aucun envoi autonome. L'envoi se fait UNIQUEMENT à la demande
 * explicite de l'humain (route /proactive/suggestions/:id/send-reply), qui peut
 * d'abord éditer le brouillon. Le rejet/vote 👎 alimente la boucle de
 * suppression existante (ai-learning), comme tous les autres types de suggestion.
 *
 * Coût/latence borné : un seul appel IA de triage par scan, puis au plus
 * MAX_DRAFTS_PER_SCAN appels de rédaction (les e-mails les plus prioritaires
 * d'abord). Tout passe par assertAiQuota -> le quota par org est respecté.
 *
 * Réutilise l'infra existante : OAuth Gmail par utilisateur (getGmailForUser),
 * table proactive_suggestions (dédup (org, dedupeKey) + index unique pending),
 * et le pipeline d'envoi Gmail (réponse dans le fil). Aucun nouveau fournisseur,
 * aucun étiquetage côté Gmail.
 */
import {
  db,
  organisationsTable,
  usersTable,
  googleOAuthTokensTable,
  proactiveSuggestionsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDbRetry } from "../lib/db-retry";
import { broadcaster } from "./broadcaster";
import { getGmailForUser } from "../lib/google-auth";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import {
  extractGeminiTokens,
  recordAiUsage,
  geminiActualModel,
  GEMINI_FLASH_MODEL,
} from "./ai-utils";
import { getSuppressedSuggestionTypes } from "./ai-learning";

/** Type de suggestion porté par ce service (hors DETECTOR_TYPES du moteur
 * déterministe : son cycle de vie est géré ICI, pas par runProactiveForOrg). */
export const EMAIL_REPLY_SUGGESTION_TYPE = "email_reply_needed";

// Nombre d'e-mails récents inspectés par scan (borne le coût Gmail + IA).
const INBOX_SCAN_SIZE = Number(process.env.AUTONOMOUS_INBOX_SCAN_SIZE ?? 25);
// Fenêtre temporelle de la boîte inspectée : un e-mail plus ancien sort du scan
// et la suggestion associée s'auto-résout (cf. note auto-résolution plus bas).
const INBOX_LOOKBACK_DAYS = Number(process.env.AUTONOMOUS_INBOX_LOOKBACK_DAYS ?? 7);
// Au plus N brouillons rédigés par scan (les plus prioritaires d'abord).
const MAX_DRAFTS_PER_SCAN = Number(process.env.AUTONOMOUS_INBOX_MAX_DRAFTS ?? 6);

interface ScannedEmail {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

interface TriageResult {
  emailId: string;
  priority: "critique" | "haute" | "normale" | "basse";
  category: string;
  needsReply: boolean;
  replyDeadline: string;
  summary: string;
  suggestedAction: string;
}

interface DraftResult {
  replySubject: string;
  replyBodyHtml: string;
  replyBodyPlain: string;
}

export interface InboxScanResult {
  scanned: number;
  candidates: number;
  created: number;
  resolved: number;
  skipped: boolean;
  reason?: string;
}

function safeJsonExtract<T>(raw: string, fallback: T): T {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as T) : fallback;
  } catch {
    return fallback;
  }
}

function extractEmailAddress(from: string): string {
  return (from.match(/<(.+?)>/)?.[1] || from || "").trim();
}

// ── Appel IA (Gemini Flash, comme l'agent autonome) ─────────────────────────
// Background -> on privilégie Flash (rapide/économique). assertAiQuota fait
// respecter le quota par org ; le repli modèle (singleton de boot) couvre les
// retraits de modèle.
async function aiGenerate(orgId: number, prompt: string, route: string): Promise<string> {
  await assertAiQuota(orgId);
  const t0 = Date.now();
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = GEMINI_FLASH_MODEL;
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = response.text ?? "{}";
  const tokens = extractGeminiTokens(response);
  recordAiUsage({
    organisationId: orgId,
    provider: "gemini",
    model: geminiActualModel(response, model),
    route,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs: Date.now() - t0,
  }).catch(() => {});
  invalidateQuotaCache(orgId);
  return text;
}

// ── Sélection de la boîte à scanner ─────────────────────────────────────────
// Gmail est PAR UTILISATEUR ; le moteur proactif est PAR ORG. On choisit un
// utilisateur "scanneur" : le compte actif de l'org ayant connecté Gmail, en
// préférant un responsable (administrateur/super_admin), puis le plus ancien.
async function pickScanningUser(orgId: number): Promise<number | null> {
  const rows = await withDbRetry(
    () =>
      db
        .select({ userId: usersTable.id, role: usersTable.role })
        .from(googleOAuthTokensTable)
        .innerJoin(usersTable, eq(usersTable.id, googleOAuthTokensTable.userId))
        .where(and(eq(usersTable.organisationId, orgId), eq(usersTable.actif, true)))
        .orderBy(usersTable.id),
    { label: "autonomous-inbox:pick-user" },
  );
  if (rows.length === 0) return null;
  const manager = rows.find((r) => r.role === "administrateur" || r.role === "super_admin");
  return (manager ?? rows[0]!).userId;
}

type GmailClient = NonNullable<Awaited<ReturnType<typeof getGmailForUser>>>;

// ── Récupération de la boîte (lecture seule) ────────────────────────────────
async function fetchInbox(gmail: GmailClient): Promise<ScannedEmail[]> {
  const q = `in:inbox newer_than:${INBOX_LOOKBACK_DAYS}d`;
  const listRes = await gmail.users.messages.list({
    userId: "me",
    maxResults: Math.min(Math.max(INBOX_SCAN_SIZE, 1), 50),
    q,
  });
  const messages = listRes.data.messages || [];
  const emails = await Promise.all(
    messages.map(async (msg): Promise<ScannedEmail | null> => {
      try {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const headers: Record<string, string> = {};
        for (const h of detail.data.payload?.headers || []) {
          if (h.name) headers[h.name.toLowerCase()] = h.value || "";
        }
        const from = headers["from"] || "";
        const labelIds = detail.data.labelIds || [];
        return {
          id: msg.id!,
          threadId: detail.data.threadId || msg.id!,
          from,
          fromEmail: extractEmailAddress(from),
          subject: headers["subject"] || "(Sans objet)",
          snippet: detail.data.snippet || "",
          date: headers["date"] || "",
          unread: labelIds.includes("UNREAD"),
        };
      } catch {
        return null;
      }
    }),
  );
  return emails.filter((e): e is ScannedEmail => e !== null);
}

// ── État d'un fil pour l'auto-résolution ────────────────────────────────────
// Une suggestion pending ne doit s'auto-résoudre QUE si l'on peut affirmer que
// le fil n'attend plus de réponse — JAMAIS simplement parce que le fil est
// absent de l'échantillon (capé à INBOX_SCAN_SIZE) du scan courant. On vérifie
// donc directement le fil : résoudre si on a répondu (dernier message envoyé /
// label SENT), si le fil est sorti de la boîte (archivé : plus aucun INBOX), ou
// s'il est introuvable (supprimé). Sinon -> garder en attente.
async function threadShouldResolve(gmail: GmailClient, threadId: string): Promise<boolean> {
  try {
    const t = await gmail.users.threads.get({ userId: "me", id: threadId, format: "minimal" });
    const msgs = t.data.messages || [];
    if (msgs.length === 0) return true;
    const last = msgs[msgs.length - 1];
    if ((last?.labelIds || []).includes("SENT")) return true; // réponse envoyée
    const anyInbox = msgs.some((m) => (m.labelIds || []).includes("INBOX"));
    if (!anyInbox) return true; // archivé / traité hors boîte
    return false; // toujours en attente d'une réponse
  } catch (err) {
    // NE résoudre QUE sur un état terminal explicite (fil supprimé -> 404).
    // Une erreur transitoire (timeout, 429, 5xx) ne prouve RIEN : on garde la
    // suggestion en attente plutôt que de la perdre silencieusement.
    const status =
      (err as { code?: number })?.code ??
      (err as { response?: { status?: number } })?.response?.status;
    return status === 404;
  }
}

// ── Triage IA (un seul appel par scan) ──────────────────────────────────────
async function triageEmails(orgId: number, emails: ScannedEmail[]): Promise<TriageResult[]> {
  const emailList = emails
    .map(
      (e, i) =>
        `[${i + 1}] ID:${e.id} | De: ${e.from} | Objet: ${e.subject} | Non-lu: ${e.unread ? "Oui" : "Non"} | Extrait: ${(e.snippet || "").slice(0, 200)}`,
    )
    .join("\n");

  const prompt = `Tu es un assistant de gestion de messagerie pour une PME française. Trie ces ${emails.length} e-mails reçus et identifie ceux qui nécessitent une réponse.

${emailList}

Réponds UNIQUEMENT en JSON valide:
{
  "triage": [
    {
      "emailId": "id exact repris ci-dessus",
      "priority": "critique|haute|normale|basse",
      "category": "commercial|client|finance|administratif|spam|information|urgence",
      "needsReply": true,
      "replyDeadline": "maintenant|aujourd_hui|cette_semaine|aucune",
      "summary": "Résumé en 1 phrase courte",
      "suggestedAction": "Action concrète à réaliser"
    }
  ]
}
Ne mets needsReply=true QUE pour de vrais e-mails attendant une réponse humaine (pas les newsletters, notifications automatiques, spam).`;

  const raw = await aiGenerate(orgId, prompt, "/autonomous-inbox/triage");
  const parsed = safeJsonExtract<{ triage?: TriageResult[] }>(raw, { triage: [] });
  return Array.isArray(parsed.triage) ? parsed.triage : [];
}

// ── Rédaction IA d'un brouillon de réponse ──────────────────────────────────
async function draftReply(
  orgId: number,
  email: ScannedEmail,
  triage: TriageResult,
): Promise<DraftResult | null> {
  const prompt = `Tu es l'assistant e-mail d'une PME française. Rédige une réponse professionnelle, courtoise et concise à cet e-mail. Réponds en français (sauf si l'e-mail est dans une autre langue). Signe au nom de l'entreprise.

De: ${email.from}
Objet: ${email.subject}
Contenu: ${(email.snippet || "").slice(0, 2000)}
Contexte (triage IA): ${triage.summary} — action suggérée: ${triage.suggestedAction}

Réponds UNIQUEMENT en JSON valide:
{
  "replySubject": "Re: ${email.subject}",
  "replyBodyHtml": "<p>Corps HTML de la réponse...</p>",
  "replyBodyPlain": "Corps en texte brut..."
}`;

  const raw = await aiGenerate(orgId, prompt, "/autonomous-inbox/draft");
  const parsed = safeJsonExtract<Partial<DraftResult>>(raw, {});
  const html = (parsed.replyBodyHtml || "").trim();
  const plain = (parsed.replyBodyPlain || "").trim();
  if (!html && !plain) return null;
  return {
    replySubject: (parsed.replySubject || `Re: ${email.subject}`).slice(0, 300),
    replyBodyHtml: html || `<p>${plain.replace(/\n/g, "<br>")}</p>`,
    replyBodyPlain: plain || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

function severityFor(priority: TriageResult["priority"]): "urgent" | "warning" {
  return priority === "critique" ? "urgent" : "warning";
}

// ── Scan complet d'une organisation ─────────────────────────────────────────
export async function runInboxScanForOrg(orgId: number): Promise<InboxScanResult> {
  const empty: InboxScanResult = { scanned: 0, candidates: 0, created: 0, resolved: 0, skipped: true };

  const userId = await pickScanningUser(orgId);
  if (!userId) return { ...empty, reason: "aucune boîte Gmail connectée" };

  const gmail = await getGmailForUser(userId);
  if (!gmail) return { ...empty, reason: "boîte Gmail déconnectée" };

  const emails = await fetchInbox(gmail);
  if (emails.length === 0) return { ...empty, reason: "boîte vide", skipped: false };

  // Triage IA. En cas d'échec (quota, IA indisponible), on N'AUTO-RÉSOUT PAS
  // (on ne sait pas si les e-mails sont traités) -> on sort sans rien toucher.
  let triage: TriageResult[];
  try {
    triage = await triageEmails(orgId, emails);
  } catch (err) {
    logger.warn({ err, orgId }, "[autonomous-inbox] triage IA échoué — scan annulé");
    return { ...empty, scanned: emails.length, reason: "triage IA échoué" };
  }

  const triageById = new Map(triage.map((t) => [String(t.emailId), t]));

  // Candidats = e-mails CRITIQUE/HAUTE nécessitant une réponse. Le criticité
  // pilote la sévérité et l'ordre de rédaction (critiques d'abord).
  const candidates = emails
    .map((e) => ({ email: e, triage: triageById.get(e.id) }))
    .filter(
      (c): c is { email: ScannedEmail; triage: TriageResult } =>
        !!c.triage &&
        c.triage.needsReply === true &&
        (c.triage.priority === "critique" || c.triage.priority === "haute"),
    )
    .sort((a, b) => (a.triage.priority === "critique" ? 0 : 1) - (b.triage.priority === "critique" ? 0 : 1));

  const candidateKeys = new Set(candidates.map((c) => `email_reply:${c.email.threadId}`));

  // Suppression apprise : si le dirigeant a durablement rejeté ce type, on ne
  // crée plus de nouvelle suggestion — SAUF urgent (jamais masqué), cohérent
  // avec filterSuppressedCandidates du moteur proactif.
  const suppressed = await getSuppressedSuggestionTypes(orgId);
  const typeSuppressed = suppressed.has(EMAIL_REPLY_SUGGESTION_TYPE);

  // Suggestions email_reply_needed actuellement pending pour l'org.
  const existing = await withDbRetry(
    () =>
      db
        .select({ id: proactiveSuggestionsTable.id, dedupeKey: proactiveSuggestionsTable.dedupeKey })
        .from(proactiveSuggestionsTable)
        .where(
          and(
            eq(proactiveSuggestionsTable.organisationId, orgId),
            eq(proactiveSuggestionsTable.type, EMAIL_REPLY_SUGGESTION_TYPE),
            eq(proactiveSuggestionsTable.status, "pending"),
          ),
        ),
    { label: "autonomous-inbox:existing-pending" },
  );
  const existingKeys = new Set(existing.map((e) => e.dedupeKey));

  // Auto-résolution PRUDENTE : une suggestion encore vue comme candidat dans ce
  // scan reste évidemment en attente. Pour les autres (absentes de l'échantillon
  // OU plus jugées needsReply), on ne résout PAS aveuglément : on interroge
  // DIRECTEMENT le fil Gmail (threadShouldResolve) — sinon un fil simplement
  // sorti de l'échantillon capé serait résolu à tort dans une boîte chargée.
  const toCheck = existing.filter((e) => !candidateKeys.has(e.dedupeKey));
  const staleIds: number[] = [];
  for (const e of toCheck) {
    const threadId = e.dedupeKey.replace(/^email_reply:/, "");
    if (!threadId) continue;
    if (await threadShouldResolve(gmail, threadId)) staleIds.push(e.id);
  }
  let resolved = 0;
  if (staleIds.length > 0) {
    await db
      .update(proactiveSuggestionsTable)
      .set({ status: "done", resolvedAt: new Date() })
      .where(
        and(
          eq(proactiveSuggestionsTable.organisationId, orgId),
          inArray(proactiveSuggestionsTable.id, staleIds),
        ),
      );
    resolved = staleIds.length;
  }

  // Création des nouvelles suggestions + brouillons (bornée). On ne (re)crée que
  // pour les candidats pas déjà pending, dans l'ordre de priorité, jusqu'au cap.
  // Suppression apprise : si le type est en sourdine, on saute les candidats
  // NON urgents (haute) mais on laisse PASSER les urgents (critique) — l'urgent
  // n'est jamais masqué, cohérent avec la politique du moteur proactif.
  let created = 0;
  {
    const toCreate = candidates.filter(
      (c) =>
        !existingKeys.has(`email_reply:${c.email.threadId}`) &&
        (!typeSuppressed || c.triage.priority === "critique"),
    );
    let drafted = 0;
    for (const c of toCreate) {
      if (drafted >= MAX_DRAFTS_PER_SCAN) break;
      const dedupeKey = `email_reply:${c.email.threadId}`;
      let draft: DraftResult | null = null;
      try {
        draft = await draftReply(orgId, c.email, c.triage);
      } catch (err) {
        // Quota épuisé ou IA indisponible en cours de rédaction -> on arrête de
        // rédiger pour ce scan (les candidats restants seront repris au suivant).
        logger.warn({ err, orgId }, "[autonomous-inbox] rédaction brouillon interrompue (quota/IA)");
        break;
      }
      drafted++;
      const severity = severityFor(c.triage.priority);
      const inserted = await db
        .insert(proactiveSuggestionsTable)
        .values({
          organisationId: orgId,
          userId: null,
          type: EMAIL_REPLY_SUGGESTION_TYPE,
          severity,
          title: `Répondre à : ${c.email.subject}`.slice(0, 200),
          detail: `${c.email.from} — ${c.triage.summary}`.slice(0, 500),
          status: "pending",
          relatedEntityType: "email",
          actionType: "send_email_reply",
          actionPayload: {
            messageId: c.email.id,
            threadId: c.email.threadId,
            from: c.email.from,
            fromEmail: c.email.fromEmail,
            subject: c.email.subject,
            snippet: c.email.snippet,
            summary: c.triage.summary,
            suggestedAction: c.triage.suggestedAction,
            category: c.triage.category,
            priority: c.triage.priority,
            replyDeadline: c.triage.replyDeadline,
            scannedByUserId: userId,
            draftSubject: draft?.replySubject ?? `Re: ${c.email.subject}`,
            draftBodyHtml: draft?.replyBodyHtml ?? "",
            draftBodyPlain: draft?.replyBodyPlain ?? "",
          },
          dedupeKey,
        })
        .onConflictDoNothing()
        .returning({ id: proactiveSuggestionsTable.id });
      if (inserted.length > 0) created++;
    }
  }

  if (created > 0 || resolved > 0) {
    try {
      broadcaster.broadcast(orgId, {
        type: "dashboard",
        action: "updated",
        meta: { source: "autonomous-inbox", created, resolved },
      });
    } catch (err) {
      logger.warn({ err, orgId }, "[autonomous-inbox] broadcast SSE échoué");
    }
  }

  return { scanned: emails.length, candidates: candidates.length, created, resolved, skipped: false };
}

// ── Envoi de la réponse approuvée (déclenché par l'humain) ──────────────────
// Réutilise le pipeline Gmail : envoie la réponse DANS LE FIL d'origine depuis
// la boîte qui a reçu l'e-mail (scannedByUserId). Jamais appelé en autonomie.
export async function sendInboxReply(input: {
  userId: number;
  to: string;
  subject: string;
  bodyHtml: string;
  threadId?: string;
  messageId?: string;
}): Promise<void> {
  const gmail = await getGmailForUser(input.userId);
  if (!gmail) throw new Error("mailbox_disconnected");

  const profile = await gmail.users.getProfile({ userId: "me" });
  const fromEmail = profile.data.emailAddress;
  const replySubject = input.subject?.startsWith("Re:") ? input.subject : `Re: ${input.subject || ""}`;

  const lines = [
    `From: ${fromEmail}`,
    `To: ${input.to}`,
    `Subject: =?utf-8?B?${Buffer.from(replySubject).toString("base64")}?=`,
    ...(input.messageId ? [`In-Reply-To: ${input.messageId}`, `References: ${input.messageId}`] : []),
    `Content-Type: text/html; charset=utf-8`,
    `MIME-Version: 1.0`,
    "",
    input.bodyHtml,
  ];
  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
  });
}

// ── Tick : toutes les organisations éligibles ───────────────────────────────
export async function runInboxScanTick(): Promise<void> {
  const orgs = await withDbRetry(
    () =>
      db
        .select({ id: organisationsTable.id })
        .from(organisationsTable)
        .where(
          and(
            eq(organisationsTable.actif, true),
            eq(organisationsTable.proactiveEngineEnabled, true),
          ),
        ),
    { label: "autonomous-inbox:tick-orgs" },
  );
  for (const org of orgs) {
    try {
      const r = await runInboxScanForOrg(org.id);
      if (!r.skipped && (r.created > 0 || r.resolved > 0)) {
        logger.info(
          { orgId: org.id, created: r.created, resolved: r.resolved, candidates: r.candidates },
          "[autonomous-inbox] scan org terminé",
        );
      }
    } catch (err) {
      logger.warn({ err, orgId: org.id }, "[autonomous-inbox] erreur organisation");
    }
  }
}
