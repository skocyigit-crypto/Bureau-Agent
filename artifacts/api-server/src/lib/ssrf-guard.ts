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

/**
 * Adresse IPv6 developpee en huit groupes de 16 bits ; null si ce n'est pas
 * une IPv6.
 *
 * Pourquoi developper au lieu de comparer du texte : `new URL` reecrit
 * `[::ffff:127.0.0.1]` en `[::ffff:7f00:1]`, et une meme adresse s'ecrit de
 * dizaines de facons (`0:0:0:0:0:ffff:7f00:1`, `::ffff:127.0.0.1`...). La
 * version precedente ne reconnaissait que la forme pointee : `::ffff:7f00:1`
 * passait pour publique, et `[::127.0.0.1]` (bloc ::/96) etait accepte
 * (releve le 22/09/2026, apres un signalement de la session BatiFlow).
 */
function groupesIpv6(ip: string): number[] | null {
  let h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  if (!h.includes(":")) return null;
  // Queue IPv4 pointee (::ffff:1.2.3.4) -> deux groupes hexadecimaux.
  const v4 = h.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(2, 6).map(Number);
    if (o.some((x) => x > 255)) return null;
    h = `${v4[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const parties = h.split("::");
  if (parties.length > 2) return null;
  const gauche = parties[0] ? parties[0].split(":") : [];
  const droite = parties.length === 2 && parties[1] ? parties[1].split(":") : [];
  const manquants = 8 - gauche.length - droite.length;
  if (parties.length === 1 ? manquants !== 0 : manquants < 1) return null;
  const tous = [...gauche, ...Array(parties.length === 2 ? manquants : 0).fill("0"), ...droite];
  if (tous.length !== 8 || tous.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return tous.map((g) => parseInt(g, 16));
}

/** Les 32 derniers bits d'une IPv6, en IPv4 pointee. */
function ipv4Finale(g: number[]): string {
  return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
}

function isBlockedIpv6(ip: string): boolean {
  const g = groupesIpv6(ip);
  if (!g) return false;
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::/96 — non specifie (::), loopback (::1) et IPv4 « compatible »
  // (deprecie) : rien de public ne s'y trouve.
  if (zeros(6)) return true;
  // ::ffff:0:0/96 — IPv4 mappee : la partie IPv4 decide.
  if (zeros(5) && g[5] === 0xffff) return isBlockedIpv4(ipv4Finale(g));
  // 64:ff9b::/96 — NAT64 : une IPv4 traduite, la partie IPv4 decide.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIpv4(ipv4Finale(g));
  // 2002::/16 — 6to4 : l'IPv4 est dans les groupes 1 et 2.
  if (g[0] === 0x2002) return isBlockedIpv4(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`);
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // lien-local fe80::/10
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast ff00::/8
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
