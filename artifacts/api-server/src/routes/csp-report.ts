/**
 * Collecte des violations de la politique de securite du contenu.
 *
 * Pourquoi cette route existe. La politique de l'application est servie en
 * `Content-Security-Policy-Report-Only` depuis le 2026-09-03: le navigateur
 * signale sans bloquer, le temps que les parcours authentifies — paiement,
 * connexion Google, televersement, VoiceLive — aient ete ouverts un a un
 * (voir deploy/csp.policy.md). Sauf qu'elle ne signalait A PERSONNE: sans
 * `report-uri`, un rapport de violation ne va nulle part. La politique
 * attendait donc une preuve que rien ne pouvait produire, et la decision de
 * la rendre bloquante ne pouvait pas avancer.
 *
 * Ce que cette route rend possible: laisser les vrais visiteurs, sur les vrais
 * parcours, produire la mesure qu'aucun test local ne peut produire.
 *
 * Trois precautions, parce qu'une route publique en est une:
 *
 *  1. elle n'est pas authentifiee — un navigateur n'envoie pas de jeton avec
 *     un rapport — donc n'importe qui peut la poster. Le corps est plafonne,
 *     le debit limite, et RIEN n'est ecrit en base: on journalise;
 *  2. un rapport porte l'adresse de la page visitee. On retire la partie
 *     requete de l'URL avant de journaliser: elle peut contenir un
 *     identifiant, un jeton, un terme de recherche. Un journal de securite
 *     n'a pas a devenir un journal de navigation;
 *  3. seuls les champs utiles au diagnostic sont retenus, et tronques. Un
 *     rapport est un objet fourni par le client: sa taille et sa forme ne
 *     sont pas de notre ressort.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import { logger } from "../lib/logger";
import { rateLimitKey } from "../lib/request-ip";

/** Longueur maximale conservee pour chaque champ d'un rapport. */
const MAX_CHAMP = 300;

/**
 * Retire la partie requete et le fragment d'une URL.
 *
 * `/factures?client=Durand&token=abc` devient `/factures`. Le chemin suffit
 * a savoir OU la violation s'est produite; le reste est de la donnee
 * personnelle qu'on n'a aucune raison d'archiver.
 */
export function assainirUrl(valeur: unknown): string | null {
  if (typeof valeur !== "string" || valeur.length === 0) return null;
  const coupe = valeur.split(/[?#]/)[0];
  return coupe.slice(0, MAX_CHAMP);
}

function texte(valeur: unknown): string | null {
  if (typeof valeur !== "string" || valeur.length === 0) return null;
  return valeur.slice(0, MAX_CHAMP);
}

export interface ViolationNormalisee {
  document: string | null;
  directive: string | null;
  bloque: string | null;
  source: string | null;
  ligne: number | null;
  disposition: string | null;
}

/**
 * Normalise un rapport, quel que soit son format.
 *
 * Deux formats coexistent dans les navigateurs: l'ancien `report-uri`, qui
 * envoie `{"csp-report": {...}}` avec des cles en tirets, et l'API Reporting,
 * qui envoie un TABLEAU d'objets `{type, body}` avec des cles en camelCase.
 * Ne lire que l'un des deux, c'est ne rien recevoir de la moitie du parc.
 */
export function normaliserRapport(charge: unknown): ViolationNormalisee[] {
  const bruts: Record<string, unknown>[] = [];

  if (Array.isArray(charge)) {
    // API Reporting: [{ type: "csp-violation", body: {...} }, ...]
    for (const entree of charge.slice(0, 20)) {
      if (entree && typeof entree === "object") {
        const corps = (entree as Record<string, unknown>).body;
        if (corps && typeof corps === "object") bruts.push(corps as Record<string, unknown>);
      }
    }
  } else if (charge && typeof charge === "object") {
    const ancien = (charge as Record<string, unknown>)["csp-report"];
    if (ancien && typeof ancien === "object") bruts.push(ancien as Record<string, unknown>);
    else bruts.push(charge as Record<string, unknown>);
  }

  return bruts.map((b) => ({
    document: assainirUrl(b["document-uri"] ?? b.documentURL),
    directive: texte(b["effective-directive"] ?? b["violated-directive"] ?? b.effectiveDirective),
    bloque: assainirUrl(b["blocked-uri"] ?? b.blockedURL),
    source: assainirUrl(b["source-file"] ?? b.sourceFile),
    ligne: typeof (b["line-number"] ?? b.lineNumber) === "number"
      ? Number(b["line-number"] ?? b.lineNumber)
      : null,
    disposition: texte(b.disposition),
  })).filter((v) => v.directive !== null || v.bloque !== null);
}

// Un navigateur qui rencontre une violation en signale souvent plusieurs
// d'affilee. La limite est donc large — il ne s'agit pas d'etrangler un
// visiteur legitime — mais elle existe: la route est publique.
const limiteur = rateLimit({
  keyGenerator: rateLimitKey,
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: false,
  legacyHeaders: false,
  // Un rapport refuse ne doit pas remplir le journal a son tour.
  message: {},
});

const router: IRouter = Router();

router.post("/csp-report", limiteur, (req: Request, res: Response) => {
  const violations = normaliserRapport(req.body);

  for (const v of violations) {
    // `warn` et non `error`: en Report-Only, une violation n'est pas une
    // panne — c'est une mesure. La traiter comme une erreur noierait les
    // vraies pannes dans le bruit d'un deploiement.
    logger.warn({ csp: v }, "[csp] violation signalee");
  }

  // 204 sans corps: le navigateur n'attend rien, et repondre du contenu a un
  // client qui ne le lit pas est du trafic pour rien.
  res.status(204).end();
});

export default router;
