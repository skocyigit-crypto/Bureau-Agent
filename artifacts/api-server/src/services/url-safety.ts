// Service partage d'analyse de securite des URL.
//
// Deux couches:
//   1. Heuristique locale (reprise de routes/gmail.ts): shorteners, TLD
//      gratuits, lookalikes de marques, IP/punycode, sous-domaines... Toujours
//      disponible, zero dependance externe, zero fuite de donnees.
//   2. Google Safe Browsing API (base de menaces reelle de Google). Activee
//      uniquement si une cle est presente (GOOGLE_SAFE_BROWSING_API_KEY ou
//      GOOGLE_API_KEY). Si la cle manque ou si l'API est desactivee dans le
//      projet GCP, on degrade GRACIEUSEMENT vers l'heuristique seule (jamais
//      d'exception remontee au caller).
//
// Confidentialite: Safe Browsing recoit l'URL (cote v4 threatMatches). Pour les
// documents/clients sensibles, l'heuristique seule suffit deja a bloquer la
// majorite du phishing courant.

import { logger } from "../lib/logger";

const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "ow.ly", "goo.gl", "buff.ly", "dlvr.it",
  "is.gd", "cli.gs", "yfrog.com", "migre.me", "ff.im", "tiny.cc", "url4.eu",
  "twit.ac", "su.pr", "twurl.nl", "snipurl.com", "short.to", "budurl.com",
  "ping.fm", "post.ly", "just.as", "bkite.com", "snipr.com", "fic.kr", "loopt.us",
  "doiop.com", "short.ie", "kl.am", "wp.me", "rubyurl.com", "om.ly", "to.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "tinycc.com", "hyperurl.co",
]);

const SUSPICIOUS_TLDS = new Set([
  ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".club", ".work", ".date",
  ".review", ".stream", ".download", ".win", ".loan", ".bid", ".racing", ".trade",
  ".accountant", ".science", ".faith", ".party", ".cricket",
]);

const SUSPICIOUS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /paypa[1l]/i, name: "Lookalike 'PayPal'" },
  { pattern: /micros[o0]ft/i, name: "Lookalike 'Microsoft'" },
  { pattern: /app[1l]e/i, name: "Lookalike 'Apple'" },
  { pattern: /g[o0]{2}gle/i, name: "Lookalike 'Google'" },
  { pattern: /amaz[o0]n/i, name: "Lookalike 'Amazon'" },
  { pattern: /faceb[o0]{2}k/i, name: "Lookalike 'Facebook'" },
  { pattern: /netf[1l]ix/i, name: "Lookalike 'Netflix'" },
  { pattern: /[a-z0-9-]+@[a-z0-9-]+\.[a-z]{2,}\.[a-z]{2,}/i, name: "Sous-domaine suspect" },
  { pattern: /secure|verify|update|confirm|login|signin|account|password|credential|urgent|suspend/i, name: "Mot-cle phishing" },
  { pattern: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/, name: "Adresse IP dans l'URL" },
  { pattern: /xn--/, name: "Domaine punycode (Unicode spoofing)" },
];

export type UrlRisk = "safe" | "suspicious" | "dangerous";

export interface UrlScanResult {
  url: string;
  displayUrl: string;
  domain: string;
  risk: UrlRisk;
  reasons: string[];
  isShortener: boolean;
  isHttps: boolean;
  /** Source ayant determine le verdict le plus eleve. */
  source?: "heuristic" | "safe_browsing";
  /** Type de menace renvoye par Safe Browsing, si applicable. */
  threatTypes?: string[];
}

/** Analyse heuristique locale d'une URL (synchrone, sans appel reseau). */
export function analyzeUrlHeuristic(rawUrl: string): UrlScanResult {
  const reasons: string[] = [];
  let risk: UrlRisk = "safe";

  let parsed: URL | null = null;
  try { parsed = new URL(rawUrl); } catch { /* invalid */ }

  const domain = parsed?.hostname ?? rawUrl.slice(0, 60);
  const displayUrl = rawUrl.length > 80 ? rawUrl.slice(0, 77) + "..." : rawUrl;

  if (!parsed) {
    return { url: rawUrl, displayUrl, domain, risk: "suspicious", reasons: ["URL non parseable"], isShortener: false, isHttps: false, source: "heuristic" };
  }

  // Allowlist de schemas: seuls http(s) sont navigables et legitimes. Tout
  // autre schema (data:, javascript:, file:, blob:, vbscript:...) sert
  // typiquement a contourner un scanner ou a executer du code -> dangereux.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      url: rawUrl,
      displayUrl,
      domain,
      risk: "dangerous",
      reasons: [`Schema d'URL non autorise (${parsed.protocol.replace(/:$/, "")})`],
      isShortener: false,
      isHttps: false,
      source: "heuristic",
    };
  }

  const isHttps = parsed.protocol === "https:";
  if (!isHttps) reasons.push("Connexion non securisee (HTTP)");

  const isShortener = URL_SHORTENERS.has(parsed.hostname.replace(/^www\./, ""));
  if (isShortener) reasons.push("Service de raccourcissement d'URL (destination inconnue)");

  const tld = "." + parsed.hostname.split(".").slice(-1)[0];
  if (SUSPICIOUS_TLDS.has(tld)) reasons.push(`TLD gratuit souvent utilise pour le phishing (${tld})`);

  for (const sp of SUSPICIOUS_PATTERNS) {
    if (sp.pattern.test(rawUrl)) reasons.push(sp.name);
  }

  if (rawUrl.length > 300) reasons.push("URL anormalement longue");
  if ((parsed.hostname.match(/\./g) || []).length > 4) reasons.push("Trop de sous-domaines");

  if (reasons.length === 0) risk = "safe";
  else if (reasons.some(r => r.includes("Lookalike") || r.includes("phishing") || r.includes("IP") || r.includes("punycode"))) risk = "dangerous";
  else risk = "suspicious";

  return { url: rawUrl, displayUrl, domain, risk, reasons, isShortener, isHttps, source: "heuristic" };
}

/** Extrait les URLs http(s) d'un texte (max 30). */
export function extractUrls(text: string): string[] {
  const urls = new Set<string>();
  const re = /https?:\/\/[^\s"'<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const url = m[0].replace(/[.,;!?]+$/, "");
    if (url.length > 10) urls.add(url);
  }
  return [...urls].slice(0, 30);
}

function getSafeBrowsingKey(): string | null {
  return process.env.GOOGLE_SAFE_BROWSING_API_KEY || process.env.GOOGLE_API_KEY || null;
}

/** Indique si la couche Safe Browsing est configuree (cle presente). */
export function isSafeBrowsingConfigured(): boolean {
  return getSafeBrowsingKey() !== null;
}

// Cache memoire court pour eviter de re-interroger Safe Browsing en boucle
// (ex: meme URL scannee dans plusieurs emails). TTL 10 min.
const SB_CACHE_TTL_MS = 10 * 60 * 1000;
const sbCache = new Map<string, { at: number; threatTypes: string[] }>();
// Disjoncteur: si l'API echoue (cle invalide / API desactivee), on arrete de
// la solliciter pendant 30 min pour ne pas ajouter de latence inutile.
let sbDisabledUntil = 0;

interface SafeBrowsingMatch {
  threatType?: string;
  threat?: { url?: string };
}

/**
 * Interroge Google Safe Browsing v4 (threatMatches:find) pour un lot d'URLs.
 * Renvoie une map url -> threatTypes (vide si aucune menace). Gracieux: en cas
 * d'erreur reseau / cle invalide / quota, renvoie une map vide et desactive
 * temporairement la couche.
 */
async function querySafeBrowsing(urls: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  const key = getSafeBrowsingKey();
  if (!key || urls.length === 0) return result;
  if (Date.now() < sbDisabledUntil) return result;

  // Sert le cache et collecte les URLs a interroger.
  const toQuery: string[] = [];
  const now = Date.now();
  for (const u of urls) {
    const cached = sbCache.get(u);
    if (cached && now - cached.at < SB_CACHE_TTL_MS) {
      if (cached.threatTypes.length > 0) result.set(u, cached.threatTypes);
    } else {
      toQuery.push(u);
    }
  }
  if (toQuery.length === 0) return result;

  try {
    const reqBody = {
      client: { clientId: "agent-de-bureau", clientVersion: "1.0.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: toQuery.slice(0, 500).map((u) => ({ url: u })),
      },
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: ctrl.signal,
      },
    ).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      // 403 = API desactivee / cle invalide -> disjoncteur 30 min.
      if (resp.status === 403 || resp.status === 400) {
        sbDisabledUntil = Date.now() + 30 * 60 * 1000;
        logger.warn({ status: resp.status }, "[url-safety] Safe Browsing desactive (cle/API), fallback heuristique");
      }
      return result;
    }

    const data = (await resp.json()) as { matches?: SafeBrowsingMatch[] };
    const matched = new Map<string, string[]>();
    for (const m of data.matches ?? []) {
      const u = m.threat?.url;
      if (!u) continue;
      const types = matched.get(u) ?? [];
      if (m.threatType) types.push(m.threatType);
      matched.set(u, types);
    }
    // Met a jour le cache pour TOUTES les URLs interrogees (menace ou non).
    for (const u of toQuery) {
      const types = matched.get(u) ?? [];
      sbCache.set(u, { at: Date.now(), threatTypes: types });
      if (types.length > 0) result.set(u, types);
    }
    // Purge opportuniste.
    if (sbCache.size > 5000) {
      for (const [k, v] of sbCache) {
        if (Date.now() - v.at > SB_CACHE_TTL_MS) sbCache.delete(k);
      }
    }
  } catch (err) {
    logger.warn({ err }, "[url-safety] exception Safe Browsing, fallback heuristique");
  }
  return result;
}

/**
 * Analyse complete d'une URL: heuristique + Safe Browsing (si configure).
 * Le verdict final prend le maximum des deux (Safe Browsing positif =>
 * "dangerous").
 */
export async function analyzeUrlFull(rawUrl: string): Promise<UrlScanResult> {
  const base = analyzeUrlHeuristic(rawUrl);
  const sb = await querySafeBrowsing([rawUrl]);
  const threats = sb.get(rawUrl);
  if (threats && threats.length > 0) {
    return {
      ...base,
      risk: "dangerous",
      reasons: [...base.reasons, ...threats.map((t) => `Google Safe Browsing: ${humanThreat(t)}`)],
      source: "safe_browsing",
      threatTypes: threats,
    };
  }
  return base;
}

/** Analyse un lot d'URLs (heuristique + Safe Browsing en un seul appel API). */
export async function analyzeUrlsBatch(urls: string[]): Promise<UrlScanResult[]> {
  const sb = await querySafeBrowsing(urls);
  return urls.map((u) => {
    const base = analyzeUrlHeuristic(u);
    const threats = sb.get(u);
    if (threats && threats.length > 0) {
      return {
        ...base,
        risk: "dangerous" as const,
        reasons: [...base.reasons, ...threats.map((t) => `Google Safe Browsing: ${humanThreat(t)}`)],
        source: "safe_browsing" as const,
        threatTypes: threats,
      };
    }
    return base;
  });
}

function humanThreat(t: string): string {
  switch (t) {
    case "MALWARE": return "logiciel malveillant";
    case "SOCIAL_ENGINEERING": return "hameconnage / phishing";
    case "UNWANTED_SOFTWARE": return "logiciel indesirable";
    case "POTENTIALLY_HARMFUL_APPLICATION": return "application potentiellement dangereuse";
    default: return t;
  }
}
