import { Router, type Request, type Response } from "express";
import { getOrgId } from "../middleware/tenant";
import { assertAiQuota, invalidateQuotaCache, AiQuotaExceededError } from "../services/ai-quota";
import { extractGeminiTokens, recordAiUsage, sanitizePromptInput } from "../services/ai-utils";
import { buildAiCacheKey, getCached, setCached, withProviderTimeout, AI_CACHE_TTL } from "../services/ai-cache";
import { logger } from "../lib/logger";

const router = Router();

const FIELD_TYPES = new Set([
  "note",
  "prospect_note",
  "email_body",
  "call_note",
  "task_description",
  "message_content",
  "project_description",
  "project_note",
  "quote_comment",
  "invoice_comment",
]);

const FIELD_GUIDANCE: Record<string, string> = {
  note: "Tu aides l'utilisateur a rediger une note interne professionnelle (memo de bureau, idee, rappel).",
  prospect_note: "Tu aides l'utilisateur a rediger une note de suivi commercial sur un prospect (CRM B2B).",
  email_body: "Tu aides l'utilisateur a rediger le corps d'un e-mail professionnel.",
  call_note: "Tu aides l'utilisateur a rediger les notes d'un appel telephonique professionnel (compte-rendu bref, sujets evoques, decisions, prochaines etapes).",
  task_description: "Tu aides l'utilisateur a rediger la description d'une tache (objectif, contexte, criteres de realisation, points d'attention).",
  message_content: "Tu aides l'utilisateur a rediger le contenu d'un message professionnel court (SMS / message interne) clair et poli.",
  project_description: "Tu aides l'utilisateur a rediger la description d'un projet (objectif, perimetre, livrables, contexte client).",
  project_note: "Tu aides l'utilisateur a rediger une note interne sur un projet (avancement, point bloquant, decision, prochaine etape).",
  quote_comment: "Tu aides l'utilisateur a rediger un commentaire ou une note commerciale sur un devis (formulation professionnelle, conditions particulieres, remerciements, validite de l'offre, modalites).",
  invoice_comment: "Tu aides l'utilisateur a rediger un commentaire ou une note sur une facture client (mention de paiement, reference de commande, conditions de reglement, remerciements, formulation comptable professionnelle).",
};

function buildPrompt(opts: {
  fieldType: string;
  text: string;
  title?: string | null;
  contactName?: string | null;
  language?: string | null;
}): string {
  const { fieldType, text, title, contactName, language } = opts;
  const lang = language && language.trim() ? language.trim() : "francais";
  const guidance = FIELD_GUIDANCE[fieldType] ?? FIELD_GUIDANCE.note;

  const contextLines: string[] = [];
  if (title && title.trim()) {
    contextLines.push(`Titre/Objet: ${title.trim().slice(0, 200)}`);
  }
  if (contactName && contactName.trim()) {
    contextLines.push(`Destinataire/Contact: ${contactName.trim().slice(0, 120)}`);
  }
  const contextBlock = contextLines.length ? `\nContexte:\n${contextLines.join("\n")}\n` : "";

  return `${guidance}
Tu es un moteur d'autocompletion inline (style ghost-text Copilot).
Langue: ${lang}.

REGLES STRICTES:
- Propose UNIQUEMENT la suite logique du texte (pas de reformulation, pas de repetition).
- Maximum UNE phrase courte ou la fin de la phrase en cours (max ~120 caracteres).
- Si le texte se termine au milieu d'un mot, complete d'abord ce mot.
- Si aucune continuation pertinente n'est possible, reponds EXACTEMENT par une chaine vide.
- N'ajoute aucun guillemet, prefixe, marqueur, balise ni explication.
- Ne repete JAMAIS le texte deja saisi.
- Conserve le ton et le style de ce qui est deja ecrit.
${contextBlock}
Texte deja saisi (le curseur est a la fin):
"""
${text}
"""

Continuation directe (texte brut, sans guillemets):`;
}

function cleanSuggestion(raw: string, originalText: string): string {
  let s = (raw ?? "").toString();
  s = s.replace(/^\s*```[a-z]*\n?/i, "").replace(/```\s*$/i, "");
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("«") && s.endsWith("»") && s.length >= 2) {
    s = s.slice(1, -1).trim();
  }
  // Refuse if model parroted the original text
  const tail = originalText.slice(-80).trim();
  if (tail && s.startsWith(tail)) {
    s = s.slice(tail.length);
  }
  if (s.length > 240) s = s.slice(0, 240);
  // Strip trailing newlines, keep at most one line
  const nl = s.indexOf("\n");
  if (nl >= 0) s = s.slice(0, nl);
  return s.trim();
}

router.post("/ai/inline-suggest", async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) { res.status(403).json({ error: "Organisation non identifiee." }); return; }

    const { fieldType, text, title, contactName, language: rawLanguage } = req.body ?? {};
    const language = typeof rawLanguage === "string" && rawLanguage.trim()
      ? rawLanguage.trim().toLowerCase()
      : "francais";
    if (!fieldType || !FIELD_TYPES.has(String(fieldType))) {
      res.status(400).json({ error: "fieldType invalide." });
      return;
    }
    const safeText = sanitizePromptInput(typeof text === "string" ? text : "", 4000);
    if (!safeText || safeText.trim().length < 3) {
      res.json({ suggestion: "" });
      return;
    }

    try {
      await assertAiQuota(orgId);
    } catch (qe) {
      if (qe instanceof AiQuotaExceededError) {
        // Fail silently for inline suggest: no quota -> no suggestion
        res.json({ suggestion: "" });
        return;
      }
      throw qe;
    }

    // Cache key uses last few words (last ~80 chars) so cache stays useful
    // while typing extra characters often re-uses the prior suggestion lookup.
    const lastWindow = safeText.slice(-80);
    const safeTitle = sanitizePromptInput(typeof title === "string" ? title : "", 200);
    const safeContact = sanitizePromptInput(typeof contactName === "string" ? contactName : "", 120);
    const cacheKey = buildAiCacheKey({
      route: "/ai/inline-suggest",
      organisationId: orgId,
      input: { fieldType, lastWindow, title: safeTitle, contactName: safeContact, language },
    });
    const cached = getCached<{ suggestion: string }>(cacheKey);
    if (cached) { res.json(cached); return; }

    const prompt = buildPrompt({
      fieldType: String(fieldType),
      text: safeText,
      title: safeTitle || null,
      contactName: safeContact || null,
      language: typeof language === "string" ? language : null,
    });

    const t0 = Date.now();
    let raw = "";
    try {
      const { ai } = await import("@workspace/integrations-gemini-ai");
      const response = await withProviderTimeout(
        () => ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: { maxOutputTokens: 80, temperature: 0.4 },
        }),
        { timeoutMs: 4000, label: "inline-suggest" },
      );
      if (typeof response === "object" && response !== null && "text" in response) {
        const t = (response as { text?: unknown }).text;
        raw = t == null ? "" : String(t);
      } else {
        raw = String(response);
      }

      const tokens = extractGeminiTokens(response);
      recordAiUsage({
        organisationId: orgId,
        provider: "gemini",
        model: "gemini-2.5-flash",
        route: "/ai/inline-suggest",
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        durationMs: Date.now() - t0,
      }).catch(() => {});
      invalidateQuotaCache(orgId);
    } catch (err: any) {
      // Fail silently per spec: no error toast on the client.
      logger.debug({ err: err?.message }, "[ai/inline-suggest] provider failed");
      res.json({ suggestion: "" });
      return;
    }

    const suggestion = cleanSuggestion(raw, safeText);
    const payload = { suggestion };
    setCached(cacheKey, payload, AI_CACHE_TTL.SHORT);
    res.json(payload);
  } catch (err: any) {
    logger.error({ err: err?.message }, "[ai/inline-suggest] error");
    // Always respond 200 with empty suggestion to keep ghost-text UX silent.
    res.json({ suggestion: "" });
  }
});

export default router;
