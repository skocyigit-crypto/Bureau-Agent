/**
 * La retenue de garantie (loi n° 71-584 du 16 juillet 1971).
 *
 * CE QU'ELLE EST
 *
 * Le maitre d'ouvrage retient une part du prix pour couvrir les reserves. En
 * BTP elle est systematique, et la loi qui l'encadre est D'ORDRE PUBLIC :
 *
 *   - le taux ne peut depasser 5 % du montant des travaux ;
 *   - la somme doit etre CONSIGNEE entre les mains d'un consignataire, et non
 *     simplement gardee par le client ;
 *   - elle est versee a l'entrepreneur un an apres la reception, meme sans
 *     mainlevee, si le maitre d'ouvrage n'a pas notifie au consignataire une
 *     opposition motivee ;
 *   - elle n'est pas pratiquee si l'entrepreneur fournit une caution
 *     personnelle et solidaire d'un etablissement financier.
 *
 * CE QUI MANQUAIT
 *
 * Mesure du 16/09 : aucune graphie de « retenue de garantie » n'existait dans
 * le depot. Trois consequences, toutes dans le meme sens :
 *
 *   - la facture annoncait un net a payer qui n'etait pas celui que le client
 *     allait regler ;
 *   - la prevision de tresorerie comptait 5 % d'encaissements qui
 *     n'arriveraient pas dans son horizon de 90 jours ;
 *   - rien ne rappelait l'echeance de restitution, et 5 % d'un marche ne se
 *     reclament pas tout seuls.
 *
 * POURQUOI ON N'INTERDIT PAS UN TAUX SUPERIEUR A 5 %
 *
 * La retenue est imposee par le client, pas choisie par l'utilisateur. Lui
 * interdire de saisir 7 % reviendrait a lui interdire de decrire son propre
 * chantier — et la facture cesserait de correspondre a ce qui se passe. On
 * enregistre la realite et on nomme l'exces, qui est recuperable puisque la
 * loi est d'ordre public. C'est la meme regle que pour les durees du travail
 * et les delais de paiement.
 */

/** Plafond legal, art. 1er de la loi n° 71-584. */
export const TAUX_MAX_LEGAL = 5;

export interface Retenue {
  /** Taux applique, tel que saisi. */
  taux: number;
  /** Montant retenu, en devise de la facture. */
  montant: number;
  /** Ce que le client doit regler immediatement. */
  netAPayer: number;
  /** Part du taux qui depasse le plafond legal. */
  tauxExcedentaire: number;
  /** Montant correspondant a cet exces, recuperable. */
  montantRecuperable: number;
  /** Vrai si une caution bancaire remplace la retenue. */
  remplaceeParCaution: boolean;
  avertissements: string[];
}

function arrondi(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Applique une retenue a un total TTC.
 *
 * La retenue porte sur le montant des travaux, TVA comprise: elle est
 * prelevee sur ce que le client verse, pas sur l'assiette de TVA. La TVA reste
 * due sur la totalite — c'est une erreur frequente que de la calculer sur le
 * net a payer.
 */
export function appliquerRetenue(
  totalTtc: number,
  taux: number | string | null | undefined,
  options: { cautionBancaire?: boolean } = {},
): Retenue {
  const total = Number.isFinite(Number(totalTtc)) ? Math.max(0, Number(totalTtc)) : 0;
  const brut = Number(taux);
  const t = Number.isFinite(brut) ? Math.max(0, brut) : 0;
  const caution = !!options.cautionBancaire;
  const avertissements: string[] = [];

  if (caution) {
    // Art. 2: la retenue n'est PAS pratiquee quand une caution personnelle et
    // solidaire est fournie. La somme reste due immediatement.
    if (t > 0) {
      avertissements.push(
        "Une caution bancaire remplace la retenue de garantie : aucune somme " +
          "ne doit etre retenue, la totalite est exigible.",
      );
    }
    return {
      taux: t,
      montant: 0,
      netAPayer: arrondi(total),
      tauxExcedentaire: 0,
      montantRecuperable: 0,
      remplaceeParCaution: true,
      avertissements,
    };
  }

  const montant = arrondi(total * (t / 100));
  const tauxExcedentaire = Math.max(0, t - TAUX_MAX_LEGAL);
  const montantRecuperable = arrondi(total * (tauxExcedentaire / 100));

  if (tauxExcedentaire > 0) {
    avertissements.push(
      `Retenue de ${t} % : le plafond legal est de ${TAUX_MAX_LEGAL} % ` +
        "(loi n° 71-584, d'ordre public). L'exces est recuperable.",
    );
  }

  if (t > 0) {
    // La consignation est l'obligation la plus souvent ignoree, et c'est elle
    // qui protege l'entrepreneur si le client fait defaut.
    avertissements.push(
      "La retenue doit etre consignee entre les mains d'un consignataire, et " +
        "non conservee par le maitre d'ouvrage.",
    );
  }

  return {
    taux: t,
    montant,
    netAPayer: arrondi(total - montant),
    tauxExcedentaire,
    montantRecuperable,
    remplaceeParCaution: false,
    avertissements,
  };
}

/**
 * Date a laquelle la retenue devient exigible.
 *
 * Un an a compter de la RECEPTION — pas de la facture, pas de la fin des
 * travaux. Rend `null` sans reception: le delai n'a alors pas commence, et
 * afficher une echeance calculee depuis la facture ferait reclamer trop tot.
 */
export function exigibiliteRetenue(
  receptionDate: Date | string | null | undefined,
): Date | null {
  if (receptionDate === null || receptionDate === undefined || receptionDate === "") return null;
  const d = receptionDate instanceof Date ? receptionDate : new Date(receptionDate);
  if (Number.isNaN(d.getTime())) return null;
  const fin = new Date(d.getTime());
  fin.setFullYear(fin.getFullYear() + 1);
  return fin;
}
