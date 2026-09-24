/**
 * Un zero rendu par l'IA est un zero, pas une absence de reponse.
 *
 * `parsed.score || 50` a l'air anodin. Il ne l'est pas : `0 || 50` vaut 50.
 * Or la consigne donnee aux agents dit, mot pour mot, « 0-30 si problemes
 * critiques ». La note la plus alarmante que l'agent puisse rendre etait donc
 * traduite en « moyen » avant d'etre enregistree — et le tableau de bord
 * affichait un bureau qui va moyennement bien alors que l'agent venait de
 * dire que rien ne va. Le repli ne signalait pas une panne : il en produisait
 * une, silencieuse, dans le sens rassurant.
 *
 * Meme forme sur les echeances : `t.dueInDays || 3`. Une tache que l'IA veut
 * pour AUJOURD'HUI (0) partait a trois jours. L'urgence etait la seule chose
 * que ce repli savait effacer.
 *
 * La regle : distinguer « absent ou illisible » de « zero ». Le premier merite
 * un repli, le second est une reponse.
 *
 * (Famille relevee par la session BTP-ULTRA le 24/09/2026 : chez elle,
 * `acomptePct: 0` — « pas d'acompte » — retombait sur 30 % par le meme
 * `o > 0 ? o : defaut`, et emettait une facture d'acompte reelle pendant que
 * l'ecran annoncait qu'aucune facture n'avait ete emise.)
 */

/**
 * Un nombre rendu par un tiers, borne, ou le repli s'il est illisible.
 *
 * `0` traverse. `null`, `undefined`, `"abc"` et `NaN` prennent le repli.
 */
export function nombreOuDefaut(
  valeur: unknown,
  defaut: number,
  bornes?: { min: number; max: number },
): number {
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  // `Number(null)` vaut 0 et `Number("")` aussi : ils ne sont pas des reponses.
  const absente = valeur === null || valeur === undefined || valeur === "";
  const retenue = !absente && Number.isFinite(n) ? n : defaut;
  if (!bornes) return retenue;
  return Math.min(bornes.max, Math.max(bornes.min, retenue));
}

/** La note d'un agent : 0 a 100, ou le repli si l'agent n'en a pas rendu. */
export function noteAgent(valeur: unknown, defaut = 50): number {
  return Math.round(nombreOuDefaut(valeur, defaut, { min: 0, max: 100 }));
}

/** Un delai en jours propose par l'IA : zero veut dire « aujourd'hui ». */
export function delaiEnJours(valeur: unknown, defaut = 3): number {
  return nombreOuDefaut(valeur, defaut, { min: 0, max: 365 });
}
