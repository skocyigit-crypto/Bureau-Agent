/**
 * Entetes d'un message sortant : aucune valeur saisie ne doit pouvoir en
 * ajouter un autre.
 *
 * Mesure le 17/09 : /gmail/send et /gmail/reply recopiaient `to`, `cc`, `bcc`
 * et l'objet directement dans les lignes d'entete, puis joignaient le tout par
 * CRLF. Un destinataire ecrit
 * `client@exemple.fr\r\nBcc: espion@ailleurs.test` ajoutait donc une copie
 * cachee — envoyee depuis la boite Gmail du salarie, avec sa signature, et
 * invisible dans l'ecran. La verification DLP (services/outgoing-dlp) porte
 * sur le champ `to` tel quel et ne voit pas le destinataire ajoute.
 *
 * Deux gardes, parce qu'elles ne protegent pas de la meme chose :
 *   - `enteteSure` refuse CR et LF (RFC 5322 : ils separent les entetes) ;
 *   - `adresseSure` refuse en plus ce qui ne ressemble pas a une liste
 *     d'adresses, pour que « Bcc: » ne passe pas non plus en une seule ligne.
 */

/** Une valeur d'entete sur une seule ligne, bornee. `null` si invalide. */
export function enteteSure(valeur: unknown, maxLongueur = 998): string | null {
  if (typeof valeur !== "string") return null;
  // CR, LF et caractere nul : ce sont eux qui coupent un entete.
  for (const c of valeur) { const code = c.charCodeAt(0); if (code === 13 || code === 10 || code === 0) return null; }
  const v = valeur.trim();
  return v.length > maxLongueur ? null : v;
}

/** Caracteres admis dans une adresse ou une liste d'adresses separees par des virgules. */
const ADRESSE = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]{2,}$/;

/**
 * Liste de destinataires normalisee (« a@x.fr, Nom <b@y.fr> »).
 * `null` si une adresse est illisible, si la ligne contient un saut de ligne,
 * ou si la liste est vide.
 */
export function adresseSure(valeur: unknown, maxDestinataires = 50): string | null {
  const ligne = enteteSure(valeur);
  if (ligne === null || ligne === "") return null;
  const parties = ligne.split(",").map((p) => p.trim()).filter(Boolean);
  if (parties.length === 0 || parties.length > maxDestinataires) return null;
  for (const partie of parties) {
    // « Nom Prenom <adresse@exemple.fr> » ou « adresse@exemple.fr »
    const entreChevrons = partie.match(/^[^<>]*<([^<>]+)>$/);
    const adresse = entreChevrons ? entreChevrons[1]!.trim() : partie;
    if (!ADRESSE.test(adresse)) return null;
  }
  return parties.join(", ");
}

/** Objet encode en base64 (RFC 2047), apres refus des sauts de ligne. */
export function objetEncode(valeur: unknown): string | null {
  const objet = enteteSure(valeur, 500);
  if (objet === null) return null;
  return `=?utf-8?B?${Buffer.from(objet).toString("base64")}?=`;
}
