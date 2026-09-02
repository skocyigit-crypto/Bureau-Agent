import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { ipKeyGenerator } from "express-rate-limit";

/**
 * Le proxy web est-il bien l'auteur de cette requete?
 *
 * `X-Real-Client-IP` decide de l'identite retenue pour TOUTES les limites de
 * debit et pour les bans du Guardian. Or le service API est joignable
 * directement (son URL `run.app` repond publiquement), et sur ce chemin-la
 * l'en-tete est simplement ce que l'appelant a bien voulu ecrire. Le changer a
 * chaque requete suffisait alors a rendre inoperante toute limite par IP:
 * anti-force-brute de la connexion, plafonds des pages publiques, bans.
 *
 * Le jeton tranche la question: Caddy le pose, un appelant direct ne le
 * connait pas.
 *
 * TANT QUE `PROXY_SHARED_TOKEN` N'EST PAS DEFINI, le comportement d'avant est
 * conserve a l'identique. C'est voulu: le deploiement se fait en trois temps
 * (ce code, puis Caddy qui pose le jeton, puis la variable qui active le
 * controle), et chacun doit etre sans effet tant que le suivant n'est pas la.
 * Activer avant que Caddy ne pose le jeton ferait perdre la vraie IP de tous
 * les visiteurs du site — l'incident du 2026-07-14, ou un seul visiteur
 * pouvait faire bannir tout le monde.
 */
function proxyIsTrusted(req: Request): boolean {
  const expected = process.env.PROXY_SHARED_TOKEN;
  if (!expected) return true; // controle non active: comportement historique
  const got = req.headers["x-proxy-token"];
  if (typeof got !== "string") return false;
  // Longueurs comparees en OCTETS: `timingSafeEqual` leve si elles different,
  // et la longueur d'une chaine n'est pas celle de son encodage.
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
 * Caddy pose X-Real-Client-IP juste avant ce hop, en recopiant la valeur de
 * X-Forwarded-For qu'IL a recue (donc la vraie IP). On la prefere ici, mais
 * seulement si le proxy s'est identifie: sans cela, n'importe quel appelant
 * direct pouvait dicter son identite (voir `proxyIsTrusted`).
 */
export function resolveClientIp(req: Request): string {
  if (proxyIsTrusted(req)) {
    const real = req.headers["x-real-client-ip"];
    if (typeof real === "string" && real.trim()) {
      return real.split(",")[0].trim();
    }
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      // DERNIERE entree, et non la premiere, des lors qu'on ne fait pas
      // confiance a l'appelant: c'est l'infrastructure qui ecrit en fin de
      // liste, l'appelant qui choisit le debut. Le choix est correct dans les
      // deux comportements possibles de la plateforme — si elle ecrase
      // l'en-tete il n'y a qu'une entree, si elle ajoute la sienne c'est la
      // derniere.
      //
      // Tant que le controle n'est pas active, on garde la premiere entree
      // pour ne rien changer au comportement en place.
      return process.env.PROXY_SHARED_TOKEN ? parts[parts.length - 1]! : parts[0]!;
    }
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
