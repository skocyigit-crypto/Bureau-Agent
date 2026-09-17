/**
 * Rapport journalier : la journee du client, pas celle de Greenwich — et rien
 * que ce qui s'est passe.
 *
 * CE QUI ETAIT MESURE LE 17/09 (POST /workspace/daily-report)
 *
 *  - La journee allait de `AAAA-MM-JJT00:00Z` a `T23:59Z` : en ete, de 2h a
 *    2h du matin a Paris. Un appel a 1h30 comptait la veille.
 *  - La date par defaut etait la date UTC : entre minuit et 2h, « aujourd'hui »
 *    designait hier.
 *  - `2026-02-31` passait l'expression reguliere ; une date future aussi, et
 *    l'IA redigeait le bilan d'une journee qui n'avait pas eu lieu.
 *  - L'IA recevait des COMPTEURS et devait rendre des « activites » avec une
 *    « plage horaire estimee ». L'ecran les affichait comme une chronologie.
 *    Des heures inventees, presentees comme des faits.
 *  - JSON illisible : le rapport etait enregistre quand meme, score 0, texte
 *    brut en resume — et ce 0 entrait dans la moyenne de la semaine.
 *  - Regenerer une date AJOUTAIT un rapport : la semaine comptait deux fois le
 *    meme jour.
 *  - Sans appel, le prompt disait « Repondus : 0 (0 %) » : l'IA commentait un
 *    taux de reponse nul qui n'existait pas.
 */

export const FUSEAU = "Europe/Paris";

/** Date calendaire locale (AAAA-MM-JJ) d'un instant. */
export function jourLocal(d: Date, fuseau = FUSEAU): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Vraie date du calendrier ? `2026-02-31` ne l'est pas. */
export function estDateCalendaire(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  // Un jour hors du mois deborde toujours sur le mois voisin : le controle du mois suffit.
  return d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1;
}

/** Decalage (ms) du fuseau par rapport a UTC a un instant donne. */
function decalage(instant: number, fuseau: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant)).map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return local - Math.floor(instant / 1000) * 1000;
}

/** Instant UTC du minuit local d'une date. */
function minuitLocal(dateStr: string, fuseau: string): Date {
  const [a, m, j] = dateStr.split("-").map(Number) as [number, number, number];
  const naif = Date.UTC(a, m - 1, j);
  // Une passe suffit pour Paris : l'heure y change a 2h/3h, jamais a minuit, donc le
  // decalage a minuit est celui de la veille au soir. Une seconde passe, essayee,
  // donnait un resultat FAUX pour une zone qui change a minuit (Havane) : retiree.
  return new Date(naif - decalage(naif, fuseau));
}

/** Bornes [debut, fin[ de la journee locale. 23 h ou 25 h les jours de changement d'heure. */
export function bornesJour(dateStr: string, fuseau = FUSEAU): { debut: Date; fin: Date } {
  const [a, m, j] = dateStr.split("-").map(Number) as [number, number, number];
  const lendemain = new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10);
  return { debut: minuitLocal(dateStr, fuseau), fin: minuitLocal(lendemain, fuseau) };
}

export type VerdictDate = { ok: true; date: string } | { ok: false; erreur: string };

/** Date du rapport : aujourd'hui (local) par defaut ; ni invalide, ni future. */
export function dateDuRapport(brut: unknown, maintenant = new Date(), fuseau = FUSEAU): VerdictDate {
  const saisie = typeof brut === "string" ? brut.trim() : "";
  const aujourdhui = jourLocal(maintenant, fuseau);
  const date = saisie || aujourdhui;
  if (!estDateCalendaire(date)) return { ok: false, erreur: "Date invalide. Utilisez AAAA-MM-JJ (date existante)." };
  if (date > aujourdhui) return { ok: false, erreur: "Impossible de generer le rapport d'une journee future." };
  return { ok: true, date };
}

/** Score IA ramene a un entier 0..100, ou `null` s'il est absent ou absurde. */
export function scoreBorne(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Ligne du prompt pour les appels repondus : pas de « 0 % » sans appel. */
export function ligneRepondus(total: number, repondus: number): string {
  if (total <= 0) return "- Repondus: sans objet (aucun appel)";
  return `- Repondus: ${repondus} (${Math.round((repondus / total) * 100)}%)`;
}

export interface EvenementBrut { createdAt: Date | string | null; categorie: "appel" | "tache" | "message"; description: string }
export interface Activite { heure: string; description: string; categorie: string }

/** Chronologie REELLE : heure d'enregistrement de chaque element, en heure locale, dans l'ordre. */
export function activitesReelles(evenements: EvenementBrut[], fuseau = FUSEAU): Activite[] {
  return evenements
    .filter((e) => e.createdAt && Number.isFinite(new Date(e.createdAt).getTime()))
    .sort((x, y) => new Date(x.createdAt!).getTime() - new Date(y.createdAt!).getTime())
    .map((e) => ({
      heure: new Date(e.createdAt!).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: fuseau }),
      description: e.description,
      categorie: e.categorie,
    }));
}
