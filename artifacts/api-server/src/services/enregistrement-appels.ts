/**
 * Enregistrer un appel n'est pas une option de plus.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `POST /telephony/...` lit `record` dans le corps de la requete et le passe
 * tel quel au fournisseur :
 *
 *     const result = await makeCall(provider.provider, config, { to, record: record === true });
 *
 * qui se traduit par `Record: "true"` chez Twilio et `record-from-answer`
 * ailleurs. Le produit DECLENCHE donc l'enregistrement lui-meme.
 *
 * Et dans tout le depot, aucune annonce : pas de « cet appel peut etre
 * enregistre », nulle part. Aucune trace non plus d'une information des
 * salaries ni d'une consultation du CSE.
 *
 * POURQUOI CELUI-CI SE REFUSE, ALORS QUE LES AUTRES SE CONTENTENT D'AVERTIR
 *
 * Les modules de conformite ecrits jusqu'ici — durees du travail, delais de
 * paiement, retenue de garantie, mentions obligatoires — DECRIVENT ce qui a eu
 * lieu. Refuser d'enregistrer une journee de treize heures produirait un
 * registre faux, et le registre sert precisement a prouver la realite.
 *
 * Ici, le produit n'enregistre pas un fait : il ACCOMPLIT un acte. Declencher
 * une captation de la voix d'un tiers sans qu'il en soit averti n'est pas une
 * description inexacte, c'est le fait lui-meme. La distinction n'est pas de
 * degre : decrire un manquement et le commettre sont deux choses differentes.
 *
 * CE QUE LE PRODUIT PEUT ET NE PEUT PAS VERIFIER
 *
 * Il ne peut verifier aucune des trois conditions : l'annonce vit dans l'IVR
 * de l'operateur, l'information des salaries et la consultation du CSE sont
 * des actes de l'entreprise. Pretendre les controler serait mentir.
 *
 * Ce qu'il peut faire, c'est refuser de declencher tant que le responsable ne
 * les a pas attestees, et conserver de cette attestation une trace datee et
 * nominative. Attester ne rend pas conforme : cela rend la responsabilite
 * explicite, et remplace un declenchement silencieux par une decision assumee.
 */

export interface OrgEnregistrement {
  enregistrementAppelsAtteste?: Date | string | null;
  enregistrementAppelsAttestePar?: number | null;
}

export interface VerdictEnregistrement {
  autorise: boolean;
  motif: string;
  /** Les conditions a reunir, rappelees quand l'attestation manque. */
  conditions: string[];
  attesteLe: Date | null;
}

export const CONDITIONS_ENREGISTREMENT = [
  "Une annonce previent l'interlocuteur que l'appel peut etre enregistre, et il peut s'y opposer en raccrochant.",
  "Les salaries dont les appels sont enregistres en ont ete informes prealablement (C. trav. art. L1222-4).",
  "Le comite social et economique a ete informe et consulte avant la mise en service (C. trav. art. L2312-38).",
] as const;

export function verifierEnregistrement(org: OrgEnregistrement): VerdictEnregistrement {
  const brut = org.enregistrementAppelsAtteste;
  const date = brut === null || brut === undefined || brut === ""
    ? null
    : brut instanceof Date
      ? brut
      : new Date(brut);

  if (!date || Number.isNaN(date.getTime())) {
    return {
      autorise: false,
      motif:
        "L'enregistrement des appels n'est pas active : les conditions prealables " +
        "n'ont pas ete attestees. Le produit declenche lui-meme l'enregistrement, " +
        "il ne peut pas le faire sans cette attestation.",
      conditions: [...CONDITIONS_ENREGISTREMENT],
      attesteLe: null,
    };
  }

  return {
    autorise: true,
    motif: "Conditions attestees : l'enregistrement peut etre declenche.",
    conditions: [],
    attesteLe: date,
  };
}
