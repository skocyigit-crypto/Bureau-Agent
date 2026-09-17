/**
 * Afficher une variation sans mentir quand on ne sait pas.
 *
 * AVANT : chaque badge de comparaison hebdomadaire etait ecrit
 *
 *     variant={diff > 0 ? "default" : "destructive"}
 *     {diff > 0 ? <ArrowUpRight/> : <ArrowDownRight/>}
 *
 * Deux defauts dans cette seule ligne :
 *
 *   - une semaine STABLE (0 %) s'affichait en rouge, fleche vers le bas ;
 *   - le serveur rendait 0 % quand il n'avait AUCUNE reference (0 appel la
 *     semaine precedente) : passer de 0 a 50 appels s'affichait donc comme une
 *     baisse.
 *
 * Le serveur rend desormais `null` quand la variation n'a pas de sens. Cette
 * fonction distingue les quatre cas, au lieu de deux.
 */

export type SensVariation = "hausse" | "baisse" | "stable" | "inconnu";

export interface AffichageVariation {
  sens: SensVariation;
  /** Texte a afficher, signe compris. Un tiret quand la valeur est inconnue. */
  texte: string;
}

export function affichageVariation(diff: number | null | undefined, unite = "%"): AffichageVariation {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) {
    return { sens: "inconnu", texte: "—" };
  }
  if (diff === 0) return { sens: "stable", texte: `0${unite}` };
  return diff > 0
    ? { sens: "hausse", texte: `+${diff}${unite}` }
    : { sens: "baisse", texte: `${diff}${unite}` };
}

/** Une valeur mesuree, ou un tiret. `0` reste `0` : c'est une mesure. */
export function valeurOuTiret(valeur: number | string | null | undefined, suffixe = ""): string {
  if (valeur === null || valeur === undefined) return "—";
  if (typeof valeur === "number" && !Number.isFinite(valeur)) return "—";
  return `${valeur}${suffixe}`;
}
