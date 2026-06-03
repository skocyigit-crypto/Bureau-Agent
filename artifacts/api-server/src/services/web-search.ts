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
  risk: UrlRisk;
  reasons: string[];
  threatTypes?: string[];
}

export interface WebSearchResponse {
  query: string;
  answer: string;
  results: WebSearchResultItem[];
}

// Nombre maximum de sources web analysees par recherche (borne le cout du
// scan antivirus + la resolution des redirections).
const MAX_RESULTS = 8;
// Budget pour resoudre une URL de redirection Gemini -> destination reelle.
const REDIRECT_TIMEOUT_MS = 4000;

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
): Promise<WebSearchResponse> {
  const cleanQuery = sanitizePromptInput(rawQuery, 300);
  const { ai } = await import("@workspace/integrations-gemini-ai");
  const model = GEMINI_FLASH_MODEL;

  const prompt = `Tu es un moteur de recherche web francophone. En t'appuyant sur la recherche Google, fournis une reponse synthetique, factuelle et a jour (3 a 5 phrases, en francais) a la requete ci-dessous. Cite des sources web fiables via la recherche. Si la requete est ambigue, reponds au sens le plus courant.\n\nRequete: ${cleanQuery}`;

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
    | { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
    | undefined;

  const rawSources: { uri: string; title: string }[] = [];
  if (gm?.groundingChunks?.length) {
    for (const chunk of gm.groundingChunks) {
      if (chunk.web?.uri) {
        rawSources.push({ uri: chunk.web.uri, title: chunk.web.title || "" });
      }
    }
  }

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
      risk: scan?.risk ?? "suspicious",
      reasons: scan?.reasons ?? [],
      threatTypes: scan?.threatTypes,
    };
  });

  return { query: cleanQuery, answer, results };
}
