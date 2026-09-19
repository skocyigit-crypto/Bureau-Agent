/**
 * Reconstituer HT / TVA / TTC a partir de ce qui a ete saisi ou lu.
 *
 * Le defaut : une depense saisie avec son seul TTC — le cas le plus courant,
 * un ticket ou une facture qu'on recopie — passait par
 *
 *     if (amountHt <= 0)  amountHt  = ttc - tva;   // tva vaut 0 => ht = ttc
 *     if (amountTva <= 0) amountTva = ttc - ht;    // => tva = 0
 *
 * et se rangeait avec le TTC dans la colonne HT et une TVA nulle. Deux torts,
 * dans le meme sens :
 *
 *  - la TVA deductible disparaissait (120 EUR de materiaux : 20 EUR de TVA
 *    jamais recuperes) ;
 *  - la charge etait surevaluee de la meme TVA, ce qui fausse le resultat et
 *    les marges de chantier.
 *
 * La regle retenue : on ne DEVINE jamais un taux. En BTP ils coexistent (20 %,
 * 10 % pour la renovation, 5,5 % pour la renovation energetique) et choisir a
 * la place de l'utilisateur ecrirait une donnee fiscale inventee. Quand le
 * taux est fourni, on calcule ; quand il ne l'est pas, on le DIT au lieu
 * d'ecrire zero en silence.
 *
 * Tout se calcule en centimes: `120 / 1.2` ne rend pas 100 en flottant.
 */
export const TAUX_TVA_CONNUS = [20, 10, 5.5, 2.1, 0] as const;

export interface MontantsProposes {
  ht?: number;
  tva?: number;
  ttc?: number;
  /** Taux en pourcentage (20 pour 20 %). */
  tauxTva?: number | null;
}

export interface MontantsDepense {
  ht: number;
  tva: number;
  ttc: number;
  /**
   * Vrai quand la TVA n'a pas pu etre etablie: seul un TTC est connu, sans
   * taux. Les montants restent exploitables (ht = ttc, tva = 0) mais cet etat
   * doit etre VISIBLE — c'est le silence qui faisait le defaut, pas le zero.
   */
  tvaInconnue: boolean;
}

const c = (v: number | undefined): number =>
  Number.isFinite(v) && (v as number) > 0 ? Math.round((v as number) * 100) : 0;

export function montantsDepense(p: MontantsProposes): MontantsDepense {
  const htC = c(p.ht);
  const tvaC = c(p.tva);
  const ttcC = c(p.ttc);
  const taux = Number.isFinite(p.tauxTva as number) && (p.tauxTva as number) >= 0
    ? (p.tauxTva as number)
    : null;

  const rendre = (ht: number, tva: number, ttc: number, inconnue = false): MontantsDepense => ({
    ht: ht / 100, tva: tva / 100, ttc: ttc / 100, tvaInconnue: inconnue,
  });

  // 1. HT et TVA connus: le TTC en decoule, meme si un TTC contradictoire a
  //    ete saisi — deux montants sur trois suffisent, et le troisieme ne doit
  //    pas pouvoir les contredire dans le registre.
  if (htC > 0 && tvaC > 0) return rendre(htC, tvaC, htC + tvaC);

  // 2. TTC et HT connus: la TVA est la difference.
  if (ttcC > 0 && htC > 0) return rendre(htC, Math.max(0, ttcC - htC), ttcC);

  // 3. TTC et TVA connus.
  if (ttcC > 0 && tvaC > 0) return rendre(Math.max(0, ttcC - tvaC), tvaC, ttcC);

  // 4. Un seul montant, mais un taux: on peut calculer.
  if (taux !== null) {
    if (ttcC > 0) {
      const ht = Math.round(ttcC / (1 + taux / 100));
      return rendre(ht, ttcC - ht, ttcC);
    }
    if (htC > 0) {
      const tva = Math.round((htC * taux) / 100);
      return rendre(htC, tva, htC + tva);
    }
  }

  // 5. HT seul, sans taux: la depense est peut-etre hors champ de TVA
  //    (assurance, salaires). Un HT sans TVA est une saisie coherente.
  if (htC > 0) return rendre(htC, 0, htC);

  // 6. TTC seul, sans taux: c'est LE cas du defaut. Les montants restent
  //    utilisables, mais l'ignorance est declaree.
  if (ttcC > 0) return rendre(ttcC, 0, ttcC, true);

  return rendre(0, 0, 0, true);
}

/**
 * Mention portee au dossier quand la TVA n'a pas pu etre lue sur le
 * justificatif. Elle s'adresse a celui qui approuve la depense: une TVA a zero
 * parce qu'elle vaut zero et une TVA a zero parce qu'on ne l'a pas lue se
 * ressemblent trop pour qu'on laisse deviner.
 */
export const NOTE_TVA_NON_LUE =
  "TVA non lue sur le justificatif : montant enregistre en TTC, TVA deductible a completer avant approbation.";
