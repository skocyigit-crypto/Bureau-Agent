/**
 * Sortir du stock ce qu'on peut, et nommer ce qui manque.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * La route de saisie vocale calculait la sortie en ligne :
 *
 *     const after = Math.max(0, before - qty);
 *     ...
 *     results.push({ ..., ok: true, message: a.summary });
 *
 * L'ecretage a zero est JUSTE — un stock negatif n'a pas de sens physique —
 * mais il etait SILENCIEUX. L'ouvrier declare dix sacs, il en reste trois : le
 * systeme en sort trois et repond « ok » avec le resume d'origine, qui parle
 * de dix.
 *
 * Sur un chantier, l'ecart n'est pas une erreur de saisie : la matiere a bien
 * ete consommee. Elle sort d'un stock qui ne la connaissait pas — reception
 * non enregistree, inventaire faux, prelevement non declare — et la
 * valorisation derive sans que personne ne voie ou.
 *
 * POURQUOI UN MODULE, ET PAS TROIS LIGNES DANS LA ROUTE
 *
 * La premiere version de ce correctif laissait le calcul dans la route et le
 * REPRODUISAIT dans le test. Une mutation de la route ne faisait alors tomber
 * aucun test : l'epreuve portait sur la copie, pas sur le code execute. Un
 * test qui reecrit ce qu'il verifie ne verifie rien.
 */

export interface SortieStock {
  /** Quantite demandee. */
  demande: number;
  /** Quantite reellement sortie. */
  sortie: number;
  /** Quantite manquante, zero si le stock suffisait. */
  manque: number;
  /** Stock apres l'operation. Jamais negatif. */
  apres: number;
}

export function calculerSortieStock(avant: number, demande: number): SortieStock {
  // Des valeurs aberrantes viennent d'une transcription vocale: « deux cents »
  // entendu pour « deux ». On ne les refuse pas ici — c'est le role de la
  // validation en amont — mais on ne les laisse pas produire de NaN.
  const stock = Number.isFinite(avant) ? Math.max(0, avant) : 0;
  const voulu = Number.isFinite(demande) ? Math.max(0, demande) : 0;

  const apres = Math.max(0, stock - voulu);
  const sortie = stock - apres;
  return { demande: voulu, sortie, manque: voulu - sortie, apres };
}
