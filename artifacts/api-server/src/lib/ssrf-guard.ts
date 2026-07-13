/**
 * ssrf-guard.ts — Garde anti-SSRF pour les requêtes sortantes vers des URLs
 * FOURNIES PAR L'UTILISATEUR (endpoints webhook d'une organisation).
 *
 * Sans cette garde, un tenant pourrait enregistrer une URL pointant vers un
 * service interne (http://169.254.169.254/ métadonnées cloud, 127.0.0.1, plages
 * RFC1918...) et détourner le serveur pour sonder/atteindre l'infrastructure
 * privée. On valide donc AVANT chaque envoi :
 *   1. le schéma (https requis en production ; http toléré hors-prod) ;
 *   2. le nom d'hôte (localhost / .local / .internal interdits) ;
 *   3. l'adresse littérale si l'hôte EST une IP ;
 *   4. la RÉSOLUTION DNS : toutes les adresses résolues doivent être publiques.
 *
 * Limite résiduelle assumée (mono-instance, B2B) : une attaque de DNS-rebinding
 * (l'IP change entre cette résolution et le fetch) n'est pas totalement couverte
 * sans épinglage d'IP ; la validation à la résolution reste l'atténuation
 * principale recommandée.
 */

import dns from "dns";

function isBlockedIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true; // "this", privé, loopback
  if (a === 169 && b === 254) return true; // link-local + métadonnées cloud
  if (a === 172 && b >= 16 && b <= 31) return true; // privé
  if (a === 192 && b === 168) return true; // privé
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / réservé
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true; // loopback / non spécifié
  if (h.startsWith("fe80:")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local (fc00::/7)
  // IPv4 mappée (::ffff:a.b.c.d) : revalider la partie IPv4.
  const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

/** Vrai si l'IP (v4 ou v6) est interne/privée/réservée → à bloquer. */
export function isBlockedIp(ip: string): boolean {
  return isBlockedIpv4(ip) || isBlockedIpv6(ip);
}

function isUnsafeHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  );
}

/**
 * Valide qu'une URL utilisateur cible bien une destination PUBLIQUE. Lève une
 * erreur explicite sinon. À appeler à la création de l'endpoint ET avant chaque
 * livraison. Retourne l'URL parsée en cas de succès.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL invalide");
  }

  const isProd = process.env.NODE_ENV === "production";
  const httpsOk = url.protocol === "https:";
  const httpDevOk = url.protocol === "http:" && !isProd;
  if (!httpsOk && !httpDevOk) {
    throw new Error(isProd ? "seul https est autorisé" : "schéma non autorisé (http/https)");
  }

  const host = url.hostname;
  if (isUnsafeHostname(host)) {
    throw new Error("hôte interne interdit");
  }
  // Hôte déjà sous forme d'IP littérale.
  if (isBlockedIp(host.replace(/^\[|\]$/g, ""))) {
    throw new Error("adresse IP privée/réservée interdite");
  }

  // Résolution DNS : toutes les adresses doivent être publiques.
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error("résolution DNS impossible");
  }
  if (addrs.length === 0) {
    throw new Error("aucune adresse résolue");
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error("l'hôte résout vers une adresse interne/privée");
    }
  }
  return url;
}
