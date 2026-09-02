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
  return false;
}
