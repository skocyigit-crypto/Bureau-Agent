/**
 * Qui doit re-accepter quoi.
 *
 * Mesure du 18/09 : l'ecran de conformite juridique ne comparait que le TYPE
 * de document. Une organisation ayant accepte les CGV 1.0 restait affichee
 * « conforme » apres la publication des CGV 1.1 — alors que c'est exactement
 * l'inverse : le texte en vigueur ne lui a jamais ete porte a connaissance, et
 * une clause nouvelle qui restreint la portee de l'engagement de l'editeur lui
 * est inopposable (C. civ. 1119). Cet ecran est le seul endroit ou un
 * super-admin peut voir qui relancer ; il affichait le contraire de ce qu'il
 * faut savoir, et le plus silencieusement possible — en vert.
 *
 * Le calcul vit ici, hors de la route, parce qu'une regle qu'on ne peut pas
 * executer seule est une regle qu'on ne peut pas prouver.
 */

/** Ce qu'une acceptation enregistree apprend, et rien de plus. */
export interface AcceptationLue {
  documentType: string;
  documentVersion: string | null;
}

export interface DocumentEnVigueur {
  version: string;
  mandatory: boolean;
}

export interface EtatConformite {
  /** Documents obligatoires sans acceptation de la version en vigueur. */
  manquants: string[];
  /** Documents (obligatoires ou non) acceptes dans la version en vigueur. */
  aJour: number;
  conforme: boolean;
}

/**
 * Une acceptation vaut pour la version qu'elle porte, pas pour le document.
 * Une version absente (`null`) ne vaut donc pour aucune version en vigueur :
 * on ne peut pas presumer qu'un texte non identifie etait le texte actuel.
 */
export function etatConformite(
  documents: Record<string, DocumentEnVigueur>,
  acceptations: AcceptationLue[],
): EtatConformite {
  const aJourPour = (code: string): boolean => {
    const attendue = documents[code]?.version;
    if (!attendue) return false;
    return acceptations.some((a) => a.documentType === code && a.documentVersion === attendue);
  };

  const codes = Object.keys(documents);
  const manquants = codes.filter((c) => documents[c].mandatory && !aJourPour(c));

  return {
    manquants,
    aJour: codes.filter(aJourPour).length,
    conforme: manquants.length === 0,
  };
}
