/**
 * La porte d'entree des routes d'IA: peut-on servir cet appel, et sinon que
 * dit-on au client.
 *
 * Deux refus possibles, et ils ne se ressemblent pas:
 *   - le quota interne de l'organisation est atteint (429, « revenez plus
 *     tard / augmentez la limite »);
 *   - l'organisation doit apporter sa propre cle et ne l'a pas fait (402, « la
 *     fonction existe, il manque de quoi la payer »).
 *
 * Pourquoi ce module existe: les routes verifiaient deja le quota avant de
 * travailler, et repondaient 429 proprement. Mais leur `catch` final termine
 * par `res.status(500).json({ error: "Erreur interne" })`. Le refus de cle,
 * leve au fond de `aiForOrg`, y serait tombe: le client aurait lu « Erreur
 * interne » au lieu de « ajoutez votre cle dans Parametres ». Un blocage
 * volontaire qui se presente comme une panne du produit est pire qu'une panne.
 *
 * D'ou la forme retenue: la meme verification que le quota, au meme endroit,
 * AVANT le travail — et un seul repondeur pour les deux cas.
 */
import type { Response } from "express";
import { assertAiQuota, AiQuotaExceededError } from "./ai-quota";
import { resolveAiAccess, AiKeyRequiredError } from "./ai-key-policy";

export { AiKeyRequiredError };

/**
 * Quota ET moyen de paiement. A appeler la ou `assertAiQuota` etait appele
 * seul: en tete de route, dans un `try` dont le `catch` passe par
 * `respondAiError`.
 */
export async function assertAiUsable(orgId: number): Promise<void> {
  await assertAiQuota(orgId);
  await resolveAiAccess(orgId);
}

/**
 * Repond au client si l'erreur est un refus connu. Rend `true` quand la
 * reponse est partie — l'appelant n'a plus qu'a sortir; `false` quand
 * l'erreur n'est pas de son ressort et doit continuer sa route (elle sera
 * tracee et rendue en 500, ce qui est correct pour une vraie panne).
 */
export function respondAiError(err: unknown, res: Response): boolean {
  if (err instanceof AiQuotaExceededError) {
    res.status(429).json({
      error: err.message,
      quotaExceeded: true,
      reason: err.reason,
      current: err.current,
      limit: err.limit,
    });
    return true;
  }
  if (err instanceof AiKeyRequiredError) {
    res.status(402).json({
      error: err.message,
      code: err.code,
      aiKeyRequired: true,
    });
    return true;
  }
  if (fournisseurInjoignable(err)) {
    // Le fournisseur de modeles ne repond pas: credit epuise, cle revoquee,
    // panne chez lui, ou reseau sortant coupe. Ce n'est pas une panne DE CE
    // SERVEUR, et le 500 le faisait croire — mesure le 18/09, l'ecran
    // d'accueil affichait « erreur serveur » alors que tout le reste
    // fonctionnait. 503 dit la verite: le service est indisponible
    // TEMPORAIREMENT, et l'ecran peut le presenter sans alarmer.
    res.status(503).json({
      error: "L'assistance par intelligence artificielle est momentanement indisponible. Le reste de l'application fonctionne normalement.",
      code: "ia_injoignable",
      iaIndisponible: true,
    });
    return true;
  }
  return false;
}

/**
 * L'erreur dit-elle « je n'ai pas pu joindre le fournisseur » ?
 *
 * On ne regarde QUE les signes d'un echec de transport: un modele qui repond
 * une betise, un JSON invalide ou un refus applicatif ne sont pas de ce
 * ressort et doivent rester des 500 — les masquer derriere « indisponible »
 * cacherait un vrai defaut du produit.
 */
export function fournisseurInjoignable(err: unknown): boolean {
  const codesReseau = new Set([
    "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN",
    "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET",
  ]);
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const o = e as { name?: string; code?: string; message?: string };
    if (typeof o.code === "string" && codesReseau.has(o.code)) return true;
    if (o.name === "AbortError" || o.name === "TimeoutError") return true;
    // `fetch failed` est le message d'undici quand la connexion n'aboutit pas;
    // la cause porte le code, mais elle est parfois perdue en chemin.
    if (typeof o.message === "string" && /^fetch failed$/i.test(o.message.trim())) return true;
  }
  return false;
}
