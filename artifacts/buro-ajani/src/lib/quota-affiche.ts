/**
 * Comment afficher un compteur d'usage « courant / plafond ».
 *
 * Deux defauts, dans le meme bloc de l'ecran d'abonnement :
 *
 *  1. Le quota d'appels etait lu sous `usage.calls`. Le serveur l'emet sous
 *     `callsThisMonth` (routes/subscriptions.ts). La cle n'existant pas,
 *     `usage.calls?.current || 0` affichait « 0/0 » — un plafond atteint, en
 *     apparence, pour toute organisation. Rien ne signalait l'erreur: le `?.`
 *     et le `|| 0` transformaient l'absence en chiffre.
 *
 *  2. `max` vaut `null` quand le plan n'impose PAS de plafond. `|| 0` le
 *     rendait « 0 » : illimite s'affichait comme interdit.
 */
export interface Compteur {
  current?: number | null;
  max?: number | null;
}

/** Le plafond, ou le signe de l'illimite. */
export function plafondAffiche(compteur: Compteur | undefined, illimite = "∞"): string {
  const max = compteur?.max;
  // `null` = pas de plafond. `0` = plafond a zero, qui est un vrai plafond.
  return max === null || max === undefined ? illimite : String(max);
}

/** Le compteur courant. Une absence vaut zero: rien n'a encore ete consomme. */
export function courantAffiche(compteur: Compteur | undefined): number {
  const n = compteur?.current;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
