/**
 * Valeurs legales en attente de renseignement.
 *
 * Elles sont regroupees ici pour une raison simple: ce sont des FAITS propres a
 * la societe — extrait Kbis, contrat d'hebergement — ou des DECISIONS
 * commerciales. Ni les uns ni les autres ne peuvent etre devines, et une valeur
 * inventee sur une page legale engage la societe.
 *
 * Tant qu'une valeur est vide, la page correspondante omet purement et
 * simplement la ligne. C'est volontaire: publier « à completer » sur une page
 * legale est un defaut plus visible que la mention manquante, et la mention
 * manquait deja avant. Une chaine vide ne degrade donc rien, et la remplir
 * corrige la page sans autre modification.
 *
 * COMMENT COMPLETER: remplir la chaine, c'est tout. La ligne apparait.
 */

export const LEGAL_INFO = {
  /**
   * Obligatoire (LCEN art. 6). Le SIRET ne le remplace pas.
   *
   * Greffe confirme: Haguenau (Bas-Rhin) releve du RCS de Strasbourg,
   * immatriculation du 27/11/2020. Valeur relevee au registre public puis
   * confirmee par l'editeur sur son Kbis — pas deduite.
   *
   * Sans le prefixe « RCS »: la page l'ecrit deja en etiquette de la ligne
   * («RCS : …»), comme pour le SIRET et le capital juste au-dessus.
   */
  rcs: "Strasbourg 890 977 648",

  /**
   * Figure sur les documents commerciaux d'une societe commerciale
   * (C. com. R123-237). A confirmer avec le conseil: la liste LCEN pour un
   * site web ne le cite pas explicitement, celle du Code de commerce si.
   *
   * Valeur confirmee par l'editeur sur son Kbis.
   */
  capitalSocial: "1 000 €",

  /**
   * Obligatoire (LCEN art. 6-III): l'hebergeur doit etre identifie par son
   * nom, son adresse ET son telephone. Les deux premiers sont deja publies.
   * Source: contrat Google Cloud EMEA Limited.
   */
  hebergeurTelephone: "",
} as const;

/** Vrai si la valeur a ete renseignee et peut etre publiee. */
export function isPublished(value: string): boolean {
  return value.trim().length > 0;
}
