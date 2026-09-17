/**
 * Rapport executif : calculs purs, sans invention.
 *
 * CE QUI ETAIT MESURE LE 17/09 (GET /smart-reports/*)
 *
 *  - Sans aucun appel, le taux de reponse valait 0 %, et l'encart « critique :
 *    taux de reponse faible, 0 % » s'affichait. Une alerte rouge pour une
 *    periode sans donnee.
 *  - Le taux de gain divisait les affaires gagnees par TOUTES les affaires
 *    creees, ouvertes comprises. La definition d'usage (CRM, HubSpot, Clozd)
 *    est gagnees / (gagnees + perdues) : une affaire ouverte n'est ni un
 *    succes ni un echec.
 *  - Le score global melait trois taux a « nouveaux contacts par jour x 100 »,
 *    plafonne a 100 : un contact par jour valait 100/100. Composante retiree.
 *  - Le tri des rappels ecrivait `ordre[severite] || 3` : `critique` vaut 0,
 *    0 est faux, et les rappels CRITIQUES passaient derriere les « info ».
 *  - `?days=` n'etait pas borne : la chronologie faisait 5 requetes PAR JOUR,
 *    `?days=100000` en lancait un demi-million.
 *  - Les jours et les heures suivaient le fuseau du serveur, UTC sur Cloud Run.
 */

export const FUSEAU = "Europe/Paris";

/** Borne un nombre de jours demande. */
export function bornerJours(brut: unknown, defaut: number, max = 365): number {
  const n = Number.parseInt(String(brut ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return defaut;
  return Math.min(n, max);
}

/** Pourcentage entier, ou `null` sans denominateur. */
export function pourcent(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return Math.round((num / den) * 100);
}

/** Taux de gain sur les affaires CONCLUES uniquement. */
export function tauxDeGain(gagnees: number, perdues: number): number | null {
  return pourcent(gagnees, gagnees + perdues);
}

/** Variation relative en %, `null` sans reference. */
export function tendance(actuel: number, precedent: number): number | null {
  if (!Number.isFinite(actuel) || !Number.isFinite(precedent) || precedent <= 0) return null;
  return Math.round(((actuel - precedent) / precedent) * 100);
}

/** Ecart en points entre deux taux, `null` si l'un manque. */
export function ecart(actuel: number | null, precedent: number | null): number | null {
  return actuel === null || precedent === null ? null : actuel - precedent;
}

/** Moyenne des composantes connues, `null` si aucune ne l'est. */
export function scoreGlobal(composantes: Array<number | null>): number | null {
  const connues = composantes.filter((c): c is number => c !== null && Number.isFinite(c));
  if (connues.length === 0) return null;
  return Math.round(connues.reduce((a, b) => a + b, 0) / connues.length);
}

const ORDRE_SEVERITE: Record<string, number> = { critique: 0, urgent: 1, alerte: 2, info: 3 };

/** Rang d'une severite. `??`, pas `||` : `critique` vaut 0. */
export function rangSeverite(severite: string): number {
  return ORDRE_SEVERITE[severite] ?? 3;
}

/** Date calendaire (AAAA-MM-JJ) d'un instant, dans le fuseau donne. */
export function jourLocal(d: Date, fuseau = FUSEAU): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Les `n` derniers jours calendaires, aujourd'hui inclus, du plus ancien au plus recent. */
export function derniersJours(n: number, maintenant = new Date(), fuseau = FUSEAU): string[] {
  const aujourdhui = jourLocal(maintenant, fuseau);
  const [a, m, j] = aujourdhui.split("-").map(Number) as [number, number, number];
  const jours: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // Arithmetique en UTC pur : aucun changement d'heure ne peut y sauter un jour.
    jours.push(new Date(Date.UTC(a, m - 1, j - i)).toISOString().slice(0, 10));
  }
  return jours;
}

/** Heure affichee a l'utilisateur, dans son fuseau et non celui du serveur. */
export function heureLocale(d: Date, fuseau = FUSEAU): string {
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: fuseau });
}

/** « Aujourd'hui » ou « Demain » selon le jour calendaire local, pas selon 24 h glissantes. */
export function libelleJour(evenement: Date, maintenant = new Date(), fuseau = FUSEAU): string {
  return jourLocal(evenement, fuseau) === jourLocal(maintenant, fuseau) ? "Aujourd'hui" : "Demain";
}
