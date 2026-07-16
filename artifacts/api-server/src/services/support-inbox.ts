/**
 * Triage IA des e-mails de support entrants.
 *
 * Les e-mails arrivant sur support@/contact@agentdebureau.fr sont captes par
 * un Cloudflare Email Worker (pas d'OAuth Gmail requis) qui les transmet a
 * POST /api/support-inbox/incoming. Ce service classe l'e-mail, redige une
 * reponse suggeree avec Gemini, et depose le tout dans la file d'approbation
 * (agent_proposals, toolName "send_email") de l'organisation super-admin —
 * exactement comme demo-request.ts/contact-request.ts y deposent deja les
 * prospects du site. AUCUN envoi automatique: un humain relit et approuve,
 * meme garde server-side que send_email ailleurs (requiresConfirmation).
 */
import { and, eq } from "drizzle-orm";
import { db, organisationsTable, agentProposalsTable } from "@workspace/db";
import { assertAiQuota, invalidateQuotaCache } from "./ai-quota";
import {
  recordAiUsage,
  extractGeminiTokens,
  geminiActualModel,
  GEMINI_FLASH_MODEL,
  sanitizePromptInput,
} from "./ai-utils";
import { logger } from "../lib/logger";

const SUPER_ADMIN_ORG_SLUG = "agent-de-bureau-sas";
const BODY_MAX = 6000;
// 700 s'est revele trop court en pratique: le JSON (summary + draftReply +
// structure) depasse regulierement cette limite et se fait tronquer en plein
// milieu, ce qui casse JSON.parse (contrairement au brouillon WhatsApp en
// texte libre, ici TOUT le contenu utile est a l'interieur du JSON).
const DRAFT_MAX_OUTPUT = 1400;
const CATEGORIES = ["demande_demo", "support", "facturation", "reclamation", "autre", "spam"] as const;
const PRIORITIES = ["haute", "moyenne", "basse"] as const;

export interface IncomingSupportEmail {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  text: string;
  messageId: string;
}

interface Classification {
  category: (typeof CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  confidence: number;
  summary: string;
  draftReply: string;
}

async function getSuperAdminOrgId(): Promise<number | null> {
  const [row] = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.slug, SUPER_ADMIN_ORG_SLUG))
    .limit(1);
  return row?.id ?? null;
}

function fallbackClassification(email: IncomingSupportEmail): Classification {
  return {
    category: "autre",
    priority: "moyenne",
    confidence: 0,
    summary: `E-mail reçu de ${email.from} — sujet: « ${email.subject} » (brouillon IA indisponible, à rédiger manuellement)`,
    draftReply: "",
  };
}

async function classifyAndDraft(orgId: number, email: IncomingSupportEmail): Promise<Classification> {
  await assertAiQuota(orgId);

  const body = sanitizePromptInput(email.text, BODY_MAX);
  const prompt = `Tu es l'assistant support d'"Ajant Bureau" (logiciel SaaS français de gestion de bureau: standardiste IA, CRM, agenda, facturation). Un e-mail est arrivé sur l'adresse support/contact publique.

E-MAIL REÇU:
De: ${email.from}${email.fromName ? ` (${email.fromName})` : ""}
Sujet: ${email.subject}
Corps:
${body}

Analyse cet e-mail et réponds UNIQUEMENT avec un JSON de cette forme exacte, sans texte autour:
{"category":"demande_demo|support|facturation|reclamation|autre|spam","priority":"haute|moyenne|basse","confidence":0-100,"summary":"résumé en une phrase pour un humain qui doit approuver la réponse","draftReply":"texte de la réponse suggérée"}

RÈGLES STRICTES pour draftReply:
- Réponds dans la MÊME langue que l'e-mail reçu.
- Ton professionnel, chaleureux, concis (maximum 6 phrases).
- N'invente JAMAIS de prix, de délai contractuel, ou d'engagement précis que tu ne peux pas garantir — reste général et propose qu'un membre de l'équipe revienne vers eux pour les détails.
- Si "category" est "spam", laisse draftReply vide ("").
- Pas de markdown, pas de signature (une signature standard sera ajoutée automatiquement à l'envoi).
- "priority" = "haute" si réclamation/problème urgent/facturation, "moyenne" si demande commerciale, "basse" si question générale ou spam probable.`;

  const { ai } = await import("@workspace/integrations-gemini-ai");
  const t0 = Date.now();
  const response = await ai.models.generateContent({
    model: GEMINI_FLASH_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: DRAFT_MAX_OUTPUT, temperature: 0.4, responseMimeType: "application/json" },
  });

  const tokens = extractGeminiTokens(response);
  recordAiUsage({
    organisationId: orgId,
    provider: "gemini",
    model: geminiActualModel(response, GEMINI_FLASH_MODEL),
    route: "/support-inbox/incoming",
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs: Date.now() - t0,
  }).catch(() => {});
  invalidateQuotaCache(orgId);

  // Le modele de repli (utilise quand gemini-2.5-flash est retire) respecte
  // moins strictement responseMimeType et enrobe parfois le JSON dans des
  // barrières de code markdown (```json ... ```) — on les retire avant de parser.
  const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ raw: raw.slice(0, 200) }, "[support-inbox] réponse IA non-JSON");
    return fallbackClassification(email);
  }

  const category = CATEGORIES.includes(parsed?.category) ? parsed.category : "autre";
  const priority = PRIORITIES.includes(parsed?.priority) ? parsed.priority : "moyenne";
  const confidence = Number.isFinite(Number(parsed?.confidence))
    ? Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))))
    : 50;
  const summary = String(parsed?.summary || "").slice(0, 500) || `E-mail reçu de ${email.from}`;
  const draftReply = String(parsed?.draftReply || "").slice(0, 4000);

  return { category, priority, confidence, summary, draftReply };
}

/**
 * Traite un e-mail entrant en arrière-plan: classe, rédige, dépose en file
 * d'approbation. Idempotent sur messageId (pas de doublon si le Worker
 * retente l'envoi). Fail-soft: toute erreur est journalisée, jamais levée —
 * appelé en fire-and-forget depuis la route webhook.
 */
export async function processIncomingSupportEmail(email: IncomingSupportEmail): Promise<void> {
  try {
    const orgId = await getSuperAdminOrgId();
    if (!orgId) {
      logger.error("[support-inbox] Organisation super-admin introuvable, e-mail ignoré.");
      return;
    }

    const sourceRef = email.messageId.slice(0, 120);
    const [existing] = await db
      .select({ id: agentProposalsTable.id })
      .from(agentProposalsTable)
      .where(and(eq(agentProposalsTable.organisationId, orgId), eq(agentProposalsTable.sourceRef, sourceRef)))
      .limit(1);
    if (existing) return;

    let classification: Classification;
    try {
      classification = await classifyAndDraft(orgId, email);
    } catch (err) {
      logger.warn({ err }, "[support-inbox] échec classification IA, dépôt sans brouillon");
      classification = fallbackClassification(email);
    }

    if (classification.category === "spam") {
      logger.info({ from: email.from, subject: email.subject }, "[support-inbox] e-mail classé spam, ignoré");
      return;
    }

    const replySubject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;

    await db.insert(agentProposalsTable).values({
      organisationId: orgId,
      runId: `support-email-${sourceRef}`,
      toolName: "send_email",
      title: `Répondre à ${email.fromName || email.from}`,
      summary: classification.summary,
      reason: `E-mail entrant (${classification.category}) via support@agentdebureau.fr`,
      args: {
        to: email.from,
        subject: replySubject,
        body: classification.draftReply || "(Aucun brouillon généré automatiquement — à rédiger manuellement.)",
        originalEmail: {
          from: email.from,
          fromName: email.fromName ?? null,
          subject: email.subject,
          text: email.text.slice(0, 4000),
        },
      },
      category: "email",
      priority: classification.priority,
      confidence: classification.confidence,
      sourceType: "support_email",
      sourceRef,
      status: "en_attente",
    });

    logger.info({ from: email.from, category: classification.category }, "[support-inbox] proposition de réponse créée");
  } catch (err) {
    logger.error({ err, from: email.from }, "[support-inbox] échec traitement e-mail entrant");
  }
}
