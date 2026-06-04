import { logger } from "../lib/logger";
import { analyzeUrlsBatch, type UrlRisk } from "./url-safety";
import {
  extractGeminiTokens,
  recordAiUsage,
  geminiActualModel,
  sanitizePromptInput,
  GEMINI_FLASH_MODEL,
} from "./ai-utils";

export interface WebSearchResultItem {
  title: string;
  url: string;
  displayUrl: string;
  domain: string;
  snippet: string;
  risk: UrlRisk;
  reasons: string[];
  threatTypes?: string[];
}

// Mode de recherche : web generaliste ou actualites recentes.
export type WebSearchMode = "web" | "news";
// Fraicheur des resultats (operateur after: + instruction au modele).
export type WebSearchFreshness = "any" | "day" | "week" | "month" | "year";
// Langue de redaction de la reponse IA.
export type WebSearchLang = "fr" | "en" | "tr";

export interface WebSearchOptions {
  mode?: WebSearchMode;
  freshness?: WebSearchFreshness;
  /** Domaine de restriction (operateur site:). Ex. "lemonde.fr". */
  site?: string;
  lang?: WebSearchLang;
}

export interface WebSearchResponse {
  query: string;
  answer: string;
  results: WebSearchResultItem[];
  relatedSearches: string[];
  // Filtres effectivement appliques (echo pour l'UI).
  mode: WebSearchMode;
  freshness: WebSearchFreshness;
  lang: WebSearchLang;
  site: string;
}

// Nombre maximum de sources web analysees par recherche (borne le cout du
// scan antivirus + la resolution des redirections).
const MAX_RESULTS = 10;
// Budget pour resoudre une URL de redirection Gemini -> destination reelle.
const REDIRECT_TIMEOUT_MS = 4000;

const FRESHNESS_DAYS: Record<Exclude<WebSearchFreshness, "any">, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

const LANG_NAME_FR: Record<WebSearchLang, string> = {
  fr: "francais",
  en: "anglais",
  tr: "turc",
};

/**
 * Normalise un domaine fourni par l'utilisateur pour l'operateur `site:`.
 * Retire le schema/`www.`/chemin, valide la forme d'un domaine. Retourne ""
 * si invalide (le filtre est alors simplement ignore).
 */
export function sanitizeSearchSite(raw?: string | null): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  s = s
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\s+/g, "");
  if (!s.includes(".") || s.length < 3 || s.length > 253) return "";
  if (!/^[a-z0-9.-]+$/.test(s)) return "";
  return s;
}

/** Borne les options brutes a des valeurs sures. */
export function normalizeWebSearchOptions(opts?: WebSearchOptions): Required<WebSearchOptions> {
  const mode: WebSearchMode = opts?.mode === "news" ? "news" : "web";
  const freshness: WebSearchFreshness =
    opts?.freshness === "day" ||
    opts?.freshness === "week" ||
    opts?.freshness === "month" ||
    opts?.freshness === "year"
      ? opts.freshness
      : "any";
  const lang: WebSearchLang = opts?.lang === "en" || opts?.lang === "tr" ? opts.lang : "fr";
  const site = sanitizeSearchSite(opts?.site);
  return { mode, freshness, site, lang };
}

/**
 * Construit l'invite de grounding en injectant les filtres (mode actualites,
 * fraicheur via after:YYYY-MM-DD, restriction site:, langue de la reponse).
 */
function buildGroundedPrompt(
  query: string,
  opts: Required<WebSearchOptions>,
): string {
  const parts: string[] = [];
  parts.push(
    `Tu es un moteur de recherche web. En t'appuyant sur la recherche Google, fournis une reponse synthetique, factuelle et a jour (3 a 5 phrases) a la requete ci-dessous. Redige ta reponse en ${LANG_NAME_FR[opts.lang]}. Cite des sources web fiables via la recherche.`,
  );
  if (opts.mode === "news") {
    parts.push(
      "Concentre-toi sur des ARTICLES D'ACTUALITE recents provenant de medias et sources d'information reputes. Donne la priorite aux informations les plus recentes.",
    );
  }
  if (opts.freshness !== "any") {
    const days = FRESHNESS_DAYS[opts.freshness];
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    parts.push(
      `Ne prends en compte que des pages publiees ou mises a jour depuis le ${cutoff} (utilise l'operateur de recherche after:${cutoff}). Ignore les contenus plus anciens.`,
    );
  }
  if (opts.site) {
    parts.push(
      `Restreins la recherche au site \u00ab ${opts.site} \u00bb uniquement (utilise l'operateur site:${opts.site}).`,
    );
  }
  parts.push("Si la requete est ambigue, reponds au sens le plus courant.");
  parts.push(`\nRequete: ${query}`);
  return parts.join("\n");
}

// Seuls les hotes de redirection du grounding Google sont contactes cote
// serveur. On ne fait JAMAIS de requete sortante vers une URL arbitraire issue
// du modele (protection anti-SSRF).
function isAllowedRedirectHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "vertexaisearch.cloud.google.com" || h.endsWith(".cloud.google.com");
}

/**
 * Refuse les hotes internes/prives en tant que destination (loopback,
 * link-local, plages RFC1918/CGNAT, metadata cloud 169.254.x, multicast, .local
 * / .internal). Defense en profondeur: on ne requete jamais la destination,
 * mais on evite aussi de l'afficher / la scanner si elle pointe en interne.
 */
function isUnsafeDestinationHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserve
  }
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  return false;
}

/**
 * Les sources renvoyees par le grounding Google de Gemini sont des URLs de
 * redirection (vertexaisearch.cloud.google.com). Pour que l'antivirus analyse
 * la vraie destination, on lit l'en-tete `Location` de la redirection.
 *
 * Anti-SSRF: on ne contacte QUE les hotes de redirection Google autorises, en
 * mode `redirect: "manual"` (jamais de suivi automatique vers une cible
 * arbitraire), et on ne requete JAMAIS la destination elle-meme — on la
 * retourne uniquement pour le scan Safe Browsing + l'affichage. Gracieux: tout
 * echec/cas non conforme retombe sur l'URL d'origine (un lien Google inoffensif).
 */
async function resolveFinalUrl(redirectUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    return redirectUrl;
  }
  if (parsed.protocol !== "https:" || !isAllowedRedirectHost(parsed.hostname)) {
    return redirectUrl;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REDIRECT_TIMEOUT_MS);
    const resp = await fetch(redirectUrl, {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentDeBureau-SafeSearch/1.0; +https://replit.com)",
      },
    });
    clearTimeout(timer);
    const location = resp.headers.get("location");
    // On n'a pas besoin du corps de la reponse de redirection.
    try {
      await resp.body?.cancel();
    } catch {
      /* ignore */
    }
    if (!location) return redirectUrl;
    let dest: URL;
    try {
      dest = new URL(location, redirectUrl);
    } catch {
      return redirectUrl;
    }
    if (
      (dest.protocol !== "http:" && dest.protocol !== "https:") ||
      isUnsafeDestinationHost(dest.hostname)
    ) {
      return redirectUrl;
    }
    return dest.toString();
  } catch {
    return redirectUrl;
  }
}

/**
 * Effectue une recherche web (via le grounding Google Search de Gemini) puis
 * fait passer chaque lien resultat par la couche antivirus/URL existante
 * (`analyzeUrlsBatch`) afin que l'utilisateur voie un verdict de securite
 * (sur / suspect / dangereux) AVANT de cliquer.
 */
export async function searchWebWithSafety(
  rawQuery: string,
  orgId: number,
  userId: number | null,
  options?: WebSearchOptions,
): Promise<WebSearchResponse> {
  const cleanQuery = sanitizePromptInput(rawQuery, 300);
  const opts = normalizeWebSearchOptions(options);
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = GEMINI_FLASH_MODEL;

  const prompt = buildGroundedPrompt(cleanQuery, opts);

  const start = Date.now();
  let response: any;
  try {
    response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });
  } catch (err) {
    logger.error({ err }, "[web-search] Gemini grounding call failed");
    throw err;
  }
  const durationMs = Date.now() - start;

  const answer = (response?.text ?? "").trim();
  const actualModel = geminiActualModel(response, model);
  const tokens = extractGeminiTokens(response);
  await recordAiUsage({
    organisationId: orgId,
    userId,
    provider: "gemini",
    model: actualModel,
    route: "/web-search",
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    durationMs,
    status: "success",
  });

  // Sources web utilisees par le modele (grounding metadata).
  const gm = response?.candidates?.[0]?.groundingMetadata as
    | {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
        groundingSupports?: {
          segment?: { text?: string };
          groundingChunkIndices?: number[];
        }[];
        webSearchQueries?: string[];
      }
    | undefined;

  // Construit un extrait (snippet) descriptif par source : on relie les segments
  // de texte de la reponse aux sources qui les appuient (groundingSupports).
  const snippetByChunk = new Map<number, string>();
  if (gm?.groundingSupports?.length) {
    for (const sup of gm.groundingSupports) {
      const text = sup.segment?.text?.trim();
      if (!text) continue;
      for (const idx of sup.groundingChunkIndices ?? []) {
        const existing = snippetByChunk.get(idx);
        if (!existing) {
          snippetByChunk.set(idx, text);
        } else if (existing.length < 240 && !existing.includes(text)) {
          snippetByChunk.set(idx, `${existing} ${text}`.slice(0, 320));
        }
      }
    }
  }

  const rawSources: { uri: string; title: string; snippet: string }[] = [];
  if (gm?.groundingChunks?.length) {
    gm.groundingChunks.forEach((chunk, idx) => {
      if (chunk.web?.uri) {
        rawSources.push({
          uri: chunk.web.uri,
          title: chunk.web.title || "",
          snippet: snippetByChunk.get(idx) ?? "",
        });
      }
    });
  }

  // Recherches associees suggerees par Google (webSearchQueries).
  const relatedSearches = Array.from(
    new Set((gm?.webSearchQueries ?? []).map((q) => q.trim()).filter(Boolean)),
  )
    .filter((q) => q.toLowerCase() !== cleanQuery.toLowerCase())
    .slice(0, 8);

  // Dedup par URI de redirection + plafond.
  const seenUri = new Set<string>();
  const limited = rawSources
    .filter((s) => {
      if (seenUri.has(s.uri)) return false;
      seenUri.add(s.uri);
      return true;
    })
    .slice(0, MAX_RESULTS);

  // Resout les redirections en parallele -> vraies destinations a scanner.
  const resolved = await Promise.all(
    limited.map(async (s) => ({ ...s, finalUrl: await resolveFinalUrl(s.uri) })),
  );

  // Dedup par URL finale (plusieurs redirections peuvent pointer au meme lien).
  const seenFinal = new Set<string>();
  const dedupedResolved = resolved.filter((r) => {
    if (seenFinal.has(r.finalUrl)) return false;
    seenFinal.add(r.finalUrl);
    return true;
  });

  // Antivirus / URL safety sur chaque destination.
  const finalUrls = dedupedResolved.map((r) => r.finalUrl);
  const scans = finalUrls.length ? await analyzeUrlsBatch(finalUrls) : [];
  const scanByUrl = new Map(scans.map((s) => [s.url, s]));

  const results: WebSearchResultItem[] = dedupedResolved.map((r) => {
    const scan = scanByUrl.get(r.finalUrl);
    return {
      title: r.title || scan?.domain || r.finalUrl,
      url: r.finalUrl,
      displayUrl: scan?.displayUrl ?? r.finalUrl,
      domain: scan?.domain ?? "",
      snippet: r.snippet,
      risk: scan?.risk ?? "suspicious",
      reasons: scan?.reasons ?? [],
      threatTypes: scan?.threatTypes,
    };
  });

  return {
    query: cleanQuery,
    answer,
    results,
    relatedSearches,
    mode: opts.mode,
    freshness: opts.freshness,
    lang: opts.lang,
    site: opts.site,
  };
}

// ---------------------------------------------------------------------------
// Suggestions de saisie ("comme Google") : completions rapides affichees PENDANT
// la frappe, sans appel IA ni quota. On interroge l'endpoint public de
// completion de Google (hote FIXE, seule la requete est un parametre encode ->
// pas de risque SSRF). Tout echec/timeout retombe sur une liste vide : la barre
// de recherche reste utilisable, aucune erreur visible.
// ---------------------------------------------------------------------------

const SUGGEST_TIMEOUT_MS = 2500;
const SUGGEST_TTL_MS = 5 * 60_000;
const SUGGEST_CACHE_MAX = 500;
const suggestCache = new Map<string, { value: string[]; exp: number }>();

export async function fetchSearchSuggestions(
  rawQuery: string,
  lang?: WebSearchLang,
): Promise<string[]> {
  const q = rawQuery.trim();
  if (q.length < 2 || q.length > 200) return [];

  const hl: WebSearchLang = lang === "en" || lang === "tr" ? lang : "fr";
  const key = `${hl}:${q.toLowerCase()}`;
  const now = Date.now();
  const hit = suggestCache.get(key);
  if (hit && hit.exp > now) return hit.value;

  let suggestions: string[] = [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SUGGEST_TIMEOUT_MS);
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&q=${encodeURIComponent(q)}`;
    const resp = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentDeBureau-Suggest/1.0; +https://replit.com)",
      },
    });
    clearTimeout(timer);
    if (resp.ok) {
      // Reponse: ["requete", ["sugg1", "sugg2", ...], ...]
      const text = await resp.text();
      const data = JSON.parse(text) as unknown;
      if (Array.isArray(data) && Array.isArray(data[1])) {
        const seen = new Set<string>();
        suggestions = (data[1] as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter((s) => {
            const k = s.toLowerCase();
            if (!s || k === key || seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 8);
      }
    }
  } catch {
    suggestions = [];
  }

  if (suggestCache.size >= SUGGEST_CACHE_MAX) {
    const firstKey = suggestCache.keys().next().value;
    if (firstKey !== undefined) suggestCache.delete(firstKey);
  }
  suggestCache.set(key, { value: suggestions, exp: now + SUGGEST_TTL_MS });
  return suggestions;
}
