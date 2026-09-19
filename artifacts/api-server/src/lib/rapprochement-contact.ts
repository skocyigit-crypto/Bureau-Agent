/**
 * Comment relier un contact a ses devis et factures, en l'absence de cle.
 *
 * Devis et factures ne portent pas l'identifiant du contact : ils portent un
 * nom et un e-mail recopies. Le rapprochement se fait donc par ressemblance —
 * ce qui oblige a dire ce qui NE ressemble a rien.
 *
 * Le defaut : le nom etait toujours transforme en `%nom%`. Un contact sans
 * prenom ni nom (une entreprise saisie avec sa seule raison sociale, un import
 * incomplet) donnait `%%`, un motif que TOUTE chaine satisfait. Sa fiche
 * affichait alors les devis et les factures de tous les clients de
 * l'organisation, avec leurs montants — et rien ne signalait que la liste
 * n'etait pas la sienne.
 *
 * Deux regles en decoulent :
 *  - un nom vide ne donne aucun motif, plutot qu'un motif universel ;
 *  - un nom d'UN caractere non plus : `%A%` ramene un client sur deux, ce qui
 *    est la meme erreur en plus discret.
 */
export function nomDeRapprochement(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  // `${null}` donne « null » : un nom absent deviendrait une chaine a
  // rapprocher, et « null Dupont » ne rapprocherait rien du bon client.
  const nom = [firstName, lastName]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  return nom.length >= 2 ? nom : null;
}

/** Le motif `ILIKE` d'un nom, ou `null` quand il n'y a rien a rapprocher. */
export function motifDeRapprochement(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const nom = nomDeRapprochement(firstName, lastName);
  return nom === null ? null : `%${nom}%`;
}
