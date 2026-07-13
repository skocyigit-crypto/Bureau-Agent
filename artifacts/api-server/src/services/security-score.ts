// F6: Score de securite agrege (0-100) + recommandations actionnables.
//
// Fonction pure et deterministe: la route /security/score collecte les
// signaux (config Safe Browsing, protection appels frauduleux, listes
// personnalisees, journal des scans) et les passe ici. Garder ce module sans
// dependance DB/reseau le rend trivial a tester et a faire evoluer.

import type { ScanVerdict } from "./security-scans";

export type FraudProtectionState = "off" | "voicemail" | "reject" | "unknown";
/** present/absent = etat connu; unknown = lecture impossible (fail-soft). */
export type CustomListsState = "present" | "absent" | "unknown";

export interface SecurityScoreInput {
  /** Google Safe Browsing configure (cle API presente). */
  safeBrowsingConfigured: boolean;
  /** Reglage de protection contre les appels frauduleux. */
  fraudProtection: FraudProtectionState;
  /** Etat des listes personnalisees (blocage/autorisation). */
  customLists: CustomListsState;
  /** Journal recent des scans (verdict + horodatage ISO). */
  recentScans: { verdict: ScanVerdict; at: string }[];
}

export type Severity = "high" | "medium" | "low";

export interface SecurityRecommendation {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface SecurityScoreResult {
  score: number; // 0-100
  rating: "excellent" | "bon" | "moyen" | "faible";
  strengths: string[];
  recommendations: SecurityRecommendation[];
  /** Detail des points retires, pour la transparence cote UI. */
  breakdown: { label: string; impact: number }[];
  /** Etats non verifiables (lecture impossible) — informatif, sans penalite. */
  notes: string[];
  threats7d: { dangerous: number; suspicious: number };
  computedAt: string;
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function ratingFor(score: number): SecurityScoreResult["rating"] {
  if (score >= 85) return "excellent";
  if (score >= 70) return "bon";
  if (score >= 50) return "moyen";
  return "faible";
}

export function computeSecurityScore(input: SecurityScoreInput): SecurityScoreResult {
  const now = Date.now();
  let dangerous = 0;
  let suspicious = 0;
  for (const s of input.recentScans) {
    const t = Date.parse(s.at);
    if (Number.isNaN(t) || now - t > WINDOW_MS) continue;
    if (s.verdict === "dangerous") dangerous++;
    else if (s.verdict === "suspicious") suspicious++;
  }

  let score = 100;
  const breakdown: { label: string; impact: number }[] = [];
  const recommendations: SecurityRecommendation[] = [];
  const strengths: string[] = [];
  const notes: string[] = [];

  // ── Couverture des protections configurables ──────────────────────────────
  if (input.safeBrowsingConfigured) {
    strengths.push("Google Safe Browsing actif");
  } else {
    score -= 12;
    breakdown.push({ label: "Google Safe Browsing non configure", impact: -12 });
    recommendations.push({
      id: "safe-browsing",
      severity: "medium",
      title: "Activez Google Safe Browsing",
      detail:
        "Ajoutez une cle API Safe Browsing pour detecter les liens malveillants connus de Google dans les emails et messages.",
    });
  }

  if (input.fraudProtection === "voicemail" || input.fraudProtection === "reject") {
    strengths.push("Protection contre les appels frauduleux active");
  } else if (input.fraudProtection === "unknown") {
    notes.push("Protection appels frauduleux : etat non verifiable pour le moment.");
  } else {
    score -= 12;
    breakdown.push({ label: "Protection appels frauduleux desactivee", impact: -12 });
    recommendations.push({
      id: "fraud-protection",
      severity: "medium",
      title: "Activez la protection contre les appels frauduleux",
      detail:
        "Configurez le renvoi vers la messagerie ou le rejet automatique des appels a mauvaise reputation dans Reglages > Appels.",
    });
  }

  if (input.customLists === "present") {
    strengths.push("Listes personnalisees de blocage/autorisation configurees");
  } else if (input.customLists === "unknown") {
    notes.push("Listes personnalisees : etat non verifiable pour le moment.");
  } else {
    score -= 6;
    breakdown.push({ label: "Aucune liste personnalisee", impact: -6 });
    recommendations.push({
      id: "custom-lists",
      severity: "low",
      title: "Ajoutez vos listes de blocage / autorisation",
      detail:
        "Bloquez les domaines et numeros indesirables, ou autorisez vos partenaires de confiance, pour affiner la protection.",
    });
  }

  // ── Exposition aux menaces recentes (7 jours) ─────────────────────────────
  if (dangerous > 0) {
    const penalty = Math.min(24, dangerous * 4);
    score -= penalty;
    breakdown.push({ label: `${dangerous} menace(s) dangereuse(s) detectee(s) (7j)`, impact: -penalty });
    recommendations.push({
      id: "recent-dangerous",
      severity: "high",
      title: `${dangerous} menace(s) dangereuse(s) recente(s)`,
      detail:
        "Consultez le Centre de securite et verifiez que les emails, liens ou appels concernes ont bien ete traites.",
    });
  }
  if (suspicious > 0) {
    const penalty = Math.min(8, suspicious);
    score -= penalty;
    breakdown.push({ label: `${suspicious} element(s) suspect(s) detecte(s) (7j)`, impact: -penalty });
  }

  if (dangerous === 0 && suspicious === 0 && input.recentScans.length > 0) {
    strengths.push("Aucune menace detectee sur les 7 derniers jours");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    rating: ratingFor(score),
    strengths,
    recommendations,
    breakdown,
    notes,
    threats7d: { dangerous, suspicious },
    computedAt: new Date().toISOString(),
  };
}
