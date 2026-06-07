import { Router, type IRouter } from "express";
import { getOrgId } from "../middleware/tenant";
import { assertAiQuota, AiQuotaExceededError } from "../services/ai-quota";
import { buildAiCacheKey, getCached, setCached, AI_CACHE_TTL } from "../services/ai-cache";
import {
  searchWebWithSafety,
  fetchSearchSuggestions,
  normalizeWebSearchOptions,
  type WebSearchResponse,
  type WebSearchLang,
} from "../services/web-search";
import { resolveInstantAnswer } from "../services/instant-answer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Recherche web "comme Google" depuis l'application, dont chaque lien resultat
 * est analyse par la couche antivirus/URL (Google Safe Browsing + heuristiques)
 * avant d'etre affiche a l'utilisateur. Tenant-scoped + quota IA.
 */
router.post("/web-search", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  const userId = req.session?.userId ?? null;

  const rawQuery = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (rawQuery.length < 2 || rawQuery.length > 300) {
    res.status(400).json({ error: "Requete de recherche invalide (2 a 300 caracteres)." });
    return;
  }

  // Normalise les filtres (mode/fraicheur/langue/site) a des valeurs sures.
  const opts = normalizeWebSearchOptions({
    mode: req.body?.mode,
    freshness: req.body?.freshness,
    lang: req.body?.lang,
    site: typeof req.body?.site === "string" ? req.body.site : undefined,
  });

  // Cache court par organisation (memes recherches frequentes -> 0 cout IA).
  // La cle inclut les filtres : changer un filtre = nouvelle recherche.
  const cacheKey = buildAiCacheKey({
    route: "/web-search",
    organisationId: orgId,
    input: {
      q: rawQuery.toLowerCase(),
      mode: opts.mode,
      freshness: opts.freshness,
      lang: opts.lang,
      site: opts.site,
    },
  });
  const cached = getCached<WebSearchResponse>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    await assertAiQuota(orgId);
  } catch (err) {
    if (err instanceof AiQuotaExceededError) {
      res.status(429).json({
        error: "Quota IA mensuel atteint. Reessayez le mois prochain ou augmentez votre forfait.",
      });
      return;
    }
    throw err;
  }

  try {
    const result = await searchWebWithSafety(rawQuery, orgId, userId, opts);
    setCached(cacheKey, result, AI_CACHE_TTL.MEDIUM);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[web-search] search failed");
    res.status(500).json({ error: "La recherche web a echoue. Reessayez." });
  }
});

/**
 * Reponse instantanee ("anlik cevap" / boite type Google) : calculatrice,
 * conversion d'unites, conversion de devises. Deterministe, rapide, SANS quota
 * IA (les taux de change passent par un service public gratuit sans cle).
 * Renvoie toujours 200 ; `instant` vaut `null` quand rien ne correspond.
 */
router.get("/web-search/instant", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.trim().length < 2 || q.length > 300) {
    res.json({ instant: null });
    return;
  }
  try {
    const instant = await resolveInstantAnswer(q);
    res.json({ instant });
  } catch (err) {
    logger.warn({ err }, "[web-search] instant answer failed");
    res.json({ instant: null });
  }
});

/**
 * Suggestions de saisie ("autocompletion") affichees PENDANT la frappe. Rapide
 * et gratuit (pas d'IA, pas de quota). Tenant-scoped. Retourne toujours 200 avec
 * un tableau (vide en cas de souci reseau) pour ne jamais casser la barre.
 */
router.get("/web-search/suggest", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "Organisation requise." });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const rawLang = typeof req.query.lang === "string" ? req.query.lang : "";
  const lang: WebSearchLang = rawLang === "en" || rawLang === "tr" ? rawLang : "fr";
  try {
    const suggestions = await fetchSearchSuggestions(q, lang);
    res.json({ suggestions });
  } catch (err) {
    logger.warn({ err }, "[web-search] suggest failed");
    res.json({ suggestions: [] });
  }
});

export default router;
