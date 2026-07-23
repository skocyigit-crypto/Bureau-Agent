/**
 * Agents de sante: dependances externes, configuration, taux d'erreurs.
 *
 * Separe de health-agents.ts pour garder les fichiers lisibles: ici vivent les
 * sondes qui SORTENT du processus (appels reseau) ou qui inspectent la
 * configuration, la ou health-agents.ts observe la base et le runtime.
 *
 * Ces trois agents adressent exactement les pannes qui ont ete constatees en
 * production sans qu'aucune supervision ne les signale:
 *   - un e-mail refuse par Resend (domaine non verifie) partait en silence ;
 *   - Google OAuth repondait 503 parce que GOOGLE_CLIENT_ID manquait ;
 *   - un limiteur mal monte renvoyait 429 sur toute l'API.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { HealthAgent, CheckResult, CheckStatus, CheckSeverity } from "./health-agents";

/** Sonde reseau avec delai maximal: une dependance lente equivaut a une panne. */
async function probe(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: opts.headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      error: err instanceof Error ? err.message : "erreur reseau",
    };
  }
}

// ── Agent 2: dependances externes ───────────────────────────────────────────

export const dependenciesAgent: HealthAgent = {
  id: "dependencies",
  name: "Services externes",
  domain: "Joignabilite REELLE de Resend, Gemini, Twilio, Google, Stripe",
  run: async () => {
    const results: CheckResult[] = [];

    // Resend. Contrairement a /discovery/scan qui se contente de verifier que
    // la variable existe, on interroge l'API avec la cle: c'est le seul moyen
    // de voir qu'une cle est revoquee ou qu'un domaine n'est pas verifie —
    // exactement le cas ou les e-mails de licence partaient "en succes"
    // apparent alors que Resend les refusait.
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      results.push({
        check: "resend",
        status: "degrade",
        severity: "haute",
        summary: "RESEND_API_KEY absent: aucun e-mail plateforme ne peut partir.",
        remediation: "Definir RESEND_API_KEY sur le service Cloud Run.",
      });
    } else {
      const r = await probe("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${resendKey}` },
      });
      let domainsNote = "";
      let verifiedOk = true;
      if (r.ok) {
        // On verifie que le domaine expediteur configure est bien VERIFIE:
        // sans cela Resend refuse l'envoi vers des tiers.
        try {
          const from = process.env.RESEND_FROM_EMAIL || "";
          const domain = (from.match(/@([^>\s]+)/)?.[1] || "").toLowerCase();
          if (domain) {
            const res = await fetch("https://api.resend.com/domains", {
              headers: { Authorization: `Bearer ${resendKey}` },
              signal: AbortSignal.timeout(6000),
            });
            const data = await res.json() as { data?: Array<{ name: string; status: string }> };
            const found = (data.data ?? []).find((d) => d.name?.toLowerCase() === domain);
            if (!found) {
              verifiedOk = false;
              domainsNote = `Le domaine expediteur "${domain}" n'est pas enregistre chez Resend.`;
            } else if (found.status !== "verified") {
              verifiedOk = false;
              domainsNote = `Le domaine "${domain}" est enregistre mais son statut est "${found.status}".`;
            } else {
              domainsNote = `Domaine expediteur "${domain}" verifie.`;
            }
          }
        } catch {
          domainsNote = "Statut des domaines non verifiable.";
        }
      }
      const status: CheckStatus = !r.ok ? "echec" : verifiedOk ? "ok" : "degrade";
      results.push({
        check: "resend",
        status,
        severity: !r.ok ? "critique" : verifiedOk ? "basse" : "haute",
        summary: !r.ok
          ? `Resend injoignable ou cle refusee (HTTP ${r.status}${r.error ? `, ${r.error}` : ""}).`
          : `Resend joignable en ${r.ms} ms. ${domainsNote}`,
        remediation: !r.ok
          ? "Verifier RESEND_API_KEY (revoquee ?) et l'etat du service Resend."
          : verifiedOk ? "" : "Verifier le domaine sur resend.com/domains, sinon les envois vers des tiers seront refuses.",
        metrics: { httpStatus: r.status, latencyMs: r.ms },
      });
    }

    // Gemini: fournisseur d'IA par defaut. S'il tombe, toute la couche IA
    // bascule ou echoue.
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!geminiKey) {
      results.push({
        check: "gemini",
        status: "degrade",
        severity: "haute",
        summary: "GEMINI_API_KEY absent: les fonctions d'IA sont indisponibles.",
        remediation: "Definir GEMINI_API_KEY sur le service Cloud Run.",
      });
    } else {
      const r = await probe(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiKey)}`);
      results.push({
        check: "gemini",
        status: r.ok ? "ok" : "echec",
        severity: r.ok ? "basse" : "haute",
        summary: r.ok
          ? `Gemini joignable en ${r.ms} ms.`
          : `Gemini injoignable ou cle refusee (HTTP ${r.status}${r.error ? `, ${r.error}` : ""}).`,
        remediation: r.ok ? "" : "Verifier GEMINI_API_KEY et le quota du projet Google.",
        metrics: { httpStatus: r.status, latencyMs: r.ms },
      });
    }

    // Google OAuth: on ne peut pas tester le flux complet sans utilisateur,
    // mais on verifie que le point de decouverte repond — cela distingue une
    // panne Google d'une configuration absente (traitee par l'agent config).
    results.push(await (async (): Promise<CheckResult> => {
      const r = await probe("https://accounts.google.com/.well-known/openid-configuration");
      return {
        check: "google_oauth_endpoint",
        status: r.ok ? "ok" : "degrade",
        severity: r.ok ? "basse" : "moyenne",
        summary: r.ok ? `Service Google OAuth joignable (${r.ms} ms).` : `Service Google OAuth injoignable (HTTP ${r.status}).`,
        remediation: r.ok ? "" : "Panne Google ou sortie reseau bloquee.",
        metrics: { httpStatus: r.status, latencyMs: r.ms },
      };
    })());

    // Twilio et Stripe: sondees uniquement si configurees — les signaler
    // "en panne" alors qu'elles ne sont pas utilisees serait du bruit.
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioToken) {
      const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
      const r = await probe(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}.json`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      results.push({
        check: "twilio",
        status: r.ok ? "ok" : "echec",
        severity: r.ok ? "basse" : "haute",
        summary: r.ok ? `Twilio joignable en ${r.ms} ms.` : `Twilio injoignable ou identifiants refuses (HTTP ${r.status}).`,
        remediation: r.ok ? "" : "Verifier TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.",
        metrics: { httpStatus: r.status, latencyMs: r.ms },
      });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      const r = await probe("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      results.push({
        check: "stripe",
        status: r.ok ? "ok" : "echec",
        severity: r.ok ? "basse" : "haute",
        summary: r.ok ? `Stripe joignable en ${r.ms} ms.` : `Stripe injoignable ou cle refusee (HTTP ${r.status}).`,
        remediation: r.ok ? "" : "Verifier STRIPE_SECRET_KEY.",
        metrics: { httpStatus: r.status, latencyMs: r.ms },
      });
    }

    return results;
  },
};

// ── Agent 3: configuration ──────────────────────────────────────────────────

/** Variables sans lesquelles une fonctionnalite entiere est muette. */
const REQUIRED_ENV: Array<{ name: string; feature: string; severity: CheckSeverity }> = [
  { name: "DATABASE_URL", feature: "toute l'application", severity: "critique" },
  { name: "SESSION_SECRET", feature: "les sessions et le chiffrement", severity: "critique" },
  { name: "DATA_ENCRYPTION_KEY", feature: "le chiffrement des identifiants tiers (BYOK)", severity: "critique" },
  { name: "GEMINI_API_KEY", feature: "l'intelligence artificielle", severity: "haute" },
  { name: "RESEND_API_KEY", feature: "l'envoi d'e-mails", severity: "haute" },
  { name: "PUBLIC_URL", feature: "les liens dans les e-mails et le retour OAuth", severity: "haute" },
];

export const configurationAgent: HealthAgent = {
  id: "configuration",
  name: "Configuration",
  domain: "Variables d'environnement, coherence OAuth, secrets",
  run: async () => {
    const results: CheckResult[] = [];

    for (const v of REQUIRED_ENV) {
      const present = Boolean(process.env[v.name]?.trim());
      results.push({
        check: `env:${v.name}`,
        status: present ? "ok" : "degrade",
        severity: present ? "basse" : v.severity,
        summary: present ? `${v.name} definie.` : `${v.name} absente — ${v.feature} ne fonctionne pas.`,
        remediation: present ? "" : `Definir ${v.name} sur le service Cloud Run.`,
      });
    }

    // Google OAuth: le piege vecu. Sans GOOGLE_REDIRECT_URI ni PUBLIC_URL,
    // l'URI de redirection retombe silencieusement sur http://localhost et
    // Google refuse la connexion — sans qu'aucune erreur n'atteigne l'app.
    results.push(await (async (): Promise<CheckResult> => {
      const hasClient = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
      const redirect = process.env.GOOGLE_REDIRECT_URI
        || (process.env.PUBLIC_URL || process.env.APP_URL || "").replace(/\/$/, "") + "/api/google-oauth/callback";
      const localhost = /localhost|127\.0\.0\.1/.test(redirect);
      const status: CheckStatus = !hasClient ? "degrade" : localhost ? "echec" : "ok";
      return {
        check: "google_oauth_config",
        status,
        severity: localhost ? "haute" : !hasClient ? "moyenne" : "basse",
        summary: !hasClient
          ? "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET absents: la connexion Google renvoie 503."
          : localhost
            ? `URI de redirection invalide en production: ${redirect}`
            : `Connexion Google configuree (redirection: ${redirect}).`,
        remediation: !hasClient
          ? "Creer un client OAuth dans Google Cloud Console et definir les deux variables."
          : localhost
            ? "Definir GOOGLE_REDIRECT_URI (ou PUBLIC_URL) sur l'URL publique, sinon Google refuse la redirection."
            : "",
        metrics: { redirectUri: redirect, clientConfigured: hasClient },
      };
    })());

    // NODE_ENV: en dehors de "production", des garde-fous se relachent
    // (chiffrement qui retombe sur SESSION_SECRET, journaux verbeux).
    results.push({
      check: "node_env",
      status: process.env.NODE_ENV === "production" ? "ok" : "degrade",
      severity: process.env.NODE_ENV === "production" ? "basse" : "moyenne",
      summary: `NODE_ENV = ${process.env.NODE_ENV || "(non defini)"}.`,
      remediation: process.env.NODE_ENV === "production" ? "" : "Definir NODE_ENV=production en production: certains garde-fous de securite en dependent.",
    });

    return results;
  },
};

// ── Agent 5: taux d'erreurs ─────────────────────────────────────────────────

/**
 * Compteur en memoire des reponses HTTP, alimente par un middleware.
 * Volontairement en memoire: le but est de reperer une degradation en cours,
 * pas de tenir un historique — et surtout de ne pas ecrire en base a chaque
 * requete, ce qui aggraverait justement une saturation du pool.
 */
const errorWindow = {
  since: Date.now(),
  total: 0,
  s4xx: 0,
  s429: 0,
  s5xx: 0,
};

export function recordHttpStatus(status: number): void {
  errorWindow.total++;
  if (status === 429) errorWindow.s429++;
  else if (status >= 500) errorWindow.s5xx++;
  else if (status >= 400) errorWindow.s4xx++;
}

/** Remet la fenetre a zero apres lecture, pour mesurer par intervalle. */
function readAndResetWindow() {
  const snapshot = { ...errorWindow, windowSec: Math.round((Date.now() - errorWindow.since) / 1000) };
  errorWindow.since = Date.now();
  errorWindow.total = 0;
  errorWindow.s4xx = 0;
  errorWindow.s429 = 0;
  errorWindow.s5xx = 0;
  return snapshot;
}

export const errorRateAgent: HealthAgent = {
  id: "errors",
  name: "Taux d'erreurs",
  domain: "Proportion de reponses 5xx et 429 sur la periode",
  run: async () => {
    const w = readAndResetWindow();
    if (w.total === 0) {
      return [{
        check: "traffic",
        status: "ok",
        severity: "basse",
        summary: `Aucune requete sur les ${w.windowSec} dernieres secondes.`,
        metrics: w,
      }];
    }

    const results: CheckResult[] = [];
    const pct5xx = (w.s5xx / w.total) * 100;
    const pct429 = (w.s429 / w.total) * 100;

    results.push({
      check: "server_errors",
      status: pct5xx >= 5 ? "echec" : pct5xx > 0 ? "degrade" : "ok",
      severity: pct5xx >= 20 ? "critique" : pct5xx >= 5 ? "haute" : pct5xx > 0 ? "moyenne" : "basse",
      summary: pct5xx === 0
        ? `Aucune erreur serveur sur ${w.total} requetes.`
        : `${w.s5xx} erreur(s) 500 sur ${w.total} requetes (${pct5xx.toFixed(1)}%).`,
      remediation: pct5xx === 0 ? "" : "Consulter les journaux: une cause frequente est la saturation du pool Postgres (voir l'agent Base de donnees).",
      metrics: { ...w, pct5xx: Number(pct5xx.toFixed(2)) },
    });

    // Un taux de 429 eleve signale presque toujours un limiteur mal calibre ou
    // mal monte, pas un abus: c'est ce qui avait rendu l'API inutilisable.
    results.push({
      check: "rate_limited",
      status: pct429 >= 10 ? "echec" : pct429 > 0 ? "degrade" : "ok",
      severity: pct429 >= 25 ? "haute" : pct429 >= 10 ? "moyenne" : "basse",
      summary: pct429 === 0
        ? `Aucune requete bloquee par les limites sur ${w.total}.`
        : `${w.s429} requete(s) bloquees en 429 sur ${w.total} (${pct429.toFixed(1)}%).`,
      remediation: pct429 === 0 ? "" : "Un taux eleve indique un limiteur trop strict ou monte sur un chemin trop large. Verifier les limiteurs dans app.ts et les routes publiques.",
      metrics: { ...w, pct429: Number(pct429.toFixed(2)) },
    });

    return results;
  },
};

/** Constats de coherence de donnees: peu couteux, executes avec les autres. */
export const dataIntegrityAgent: HealthAgent = {
  id: "integrity",
  name: "Integrite des donnees",
  domain: "Lignes orphelines et incoherences structurelles",
  run: async () => {
    const results: CheckResult[] = [];
    try {
      // Utilisateurs rattaches a une organisation supprimee: symptome typique
      // d'une suppression incomplete, invisible tant que personne ne se
      // connecte avec ce compte.
      const r = await db.execute<{ orphans: number }>(sql`
        SELECT count(*)::int AS orphans
        FROM users u
        LEFT JOIN organisations o ON o.id = u.organisation_id
        WHERE u.organisation_id IS NOT NULL AND o.id IS NULL
      `);
      const orphans = Number((r as unknown as { rows: Array<{ orphans: number }> }).rows?.[0]?.orphans ?? 0);
      results.push({
        check: "orphan_users",
        status: orphans > 0 ? "degrade" : "ok",
        severity: orphans > 0 ? "moyenne" : "basse",
        summary: orphans > 0
          ? `${orphans} utilisateur(s) rattache(s) a une organisation inexistante.`
          : "Aucun utilisateur orphelin.",
        remediation: orphans > 0 ? "Rattacher ces comptes a une organisation valide ou les desactiver." : "",
        metrics: { orphans },
      });
    } catch (err) {
      logger.warn({ err }, "[Health] Verification d'integrite impossible");
      results.push({
        check: "orphan_users",
        status: "inconnu",
        severity: "basse",
        summary: "Verification d'integrite non executable.",
      });
    }
    return results;
  },
};
