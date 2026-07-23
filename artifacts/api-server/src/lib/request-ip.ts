import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * Resout l'IP reelle du visiteur, en tenant compte du hop Caddy -> Cloud Run
 * qui detruit X-Forwarded-For (cf. deploy/Caddyfile.cloudrun).
 *
 * Chaine reelle: client -> Cloud Run (edge web) -> Caddy -> Cloud Run
 * (edge api) -> Express. Le premier hop pose X-Forwarded-For correctement,
 * mais le second (Caddy -> edge api, un appel HTTPS "externe" du point de
 * vue de Cloud Run) l'ecrase par une adresse interne partagee — TOUS les
 * visiteurs du site web se retrouvaient alors identifies par la MEME IP
 * cote Guardian/rate-limit (incident du 2026-07-14, cf.
 * AI_AUTOMATION_ROADMAP.md: un seul visiteur pouvait epuiser le quota ou
 * declencher un ban pour tout le monde).
 *
 * Caddy pose desormais X-Real-Client-IP juste avant ce hop, en recopiant
 * la valeur de X-Forwarded-For qu'IL a recue (donc la vraie IP). On la
 * prefere ici ; si absente (appel direct a l'api, hors du proxy web —
 * l'app mobile, un appel de test), on retombe sur X-Forwarded-For standard.
 */
export function resolveClientIp(req: Request): string {
  const real = req.headers["x-real-client-ip"];
  if (typeof real === "string" && real.trim()) {
    return real.split(",")[0].trim();
  }
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Cle de limitation de debit derivee de l'IP du visiteur.
 *
 * A utiliser comme `keyGenerator` de TOUS les rate limiters, plutot que
 * `resolveClientIp` directement. La difference porte sur IPv6: un abonne se
 * voit couramment attribuer un prefixe entier (/64, soit des milliards
 * d'adresses). Compter par adresse exacte laisserait donc un utilisateur IPv6
 * contourner n'importe quelle limite en changeant d'adresse a chaque requete,
 * alors qu'un utilisateur IPv4 serait, lui, bien limite.
 *
 * `ipKeyGenerator` regroupe les adresses IPv6 par prefixe et laisse les
 * adresses IPv4 inchangees. C'est aussi ce que reclame express-rate-limit, qui
 * emettait sinon une ValidationError a chaque construction de limiteur.
 */
export function rateLimitKey(req: Request): string {
  return ipKeyGenerator(resolveClientIp(req));
}
