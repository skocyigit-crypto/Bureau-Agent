/**
 * Une tache recurrente qui ne revenait jamais.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `tasks` porte trois colonnes — `isRecurring`, `recurrenceRule`,
 * `recurrenceEndDate` — et l'interface offre six frequences (quotidien,
 * hebdomadaire, bihebdomadaire, mensuel, trimestriel, annuel) plus une date de
 * fin. Le guide utilisateur documente la fonction.
 *
 * Dans tout le serveur, ces trois colonnes n'etaient lues qu'a UN seul endroit:
 * l'export CSV, pour ecrire « Oui » ou « Non » dans une colonne. Aucun
 * traitement, aucun cron, aucun declencheur a l'achevement.
 *
 * L'utilisateur coche « chaque lundi », termine la tache une fois, et elle ne
 * revient jamais. C'est une promesse de l'interface que rien ne tient — la
 * meme forme que la politique de conservation annoncee sans traitement, ou que
 * la notification de violation promise au contrat sans mecanisme.
 *
 * LE CHOIX : REGENERER A L'ACHEVEMENT, PAS PAR UN CRON
 *
 * Un cron devrait decider seul quand creer la prochaine occurrence, et
 * produirait des doublons si la precedente n'est pas terminee. Regenerer au
 * moment ou la tache est achevee donne exactement une occurrence suivante, au
 * moment ou elle a un sens, et sans tache de fond a surveiller.
 *
 * L'ANCRAGE EST LA DATE D'ECHEANCE, PAS LA DATE D'ACHEVEMENT
 *
 * Sinon une tache hebdomadaire terminee avec trois jours de retard decalerait
 * toutes les suivantes de trois jours, puis de six, et « chaque lundi »
 * finirait un jeudi.
 *
 * Mais on n'engendre pas non plus une occurrence deja passee : une tache
 * terminee avec deux mois de retard produirait huit occurrences en retard.
 * L'echeance est donc avancee jusqu'a depasser le moment present.
 */

export type Frequence =
  | "quotidien"
  | "hebdomadaire"
  | "bihebdomadaire"
  | "mensuel"
  | "trimestriel"
  | "annuel";

/** Les six frequences offertes par l'interface, et elles seules. */
export const FREQUENCES: readonly Frequence[] = [
  "quotidien",
  "hebdomadaire",
  "bihebdomadaire",
  "mensuel",
  "trimestriel",
  "annuel",
] as const;

const JOURS: Partial<Record<Frequence, number>> = {
  quotidien: 1,
  hebdomadaire: 7,
  bihebdomadaire: 14,
};

const MOIS: Partial<Record<Frequence, number>> = {
  mensuel: 1,
  trimestriel: 3,
  annuel: 12,
};

/**
 * Ajoute des mois en CONSERVANT la fin de mois.
 *
 * `setMonth` deborde: le 31 janvier + 1 mois donne le 3 mars, parce que
 * fevrier n'a pas 31 jours. Une tache mensuelle creee un 31 sauterait donc
 * fevrier et deriverait de quelques jours a chaque passage.
 *
 * On ramene au dernier jour du mois cible, ce que fait n'importe quel agenda.
 */
function ajouterMois(d: Date, mois: number): Date {
  const jour = d.getUTCDate();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mois, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const dernierJour = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(jour, dernierJour));
  return base;
}

/** Echeance suivante, ou `null` si la regle est inconnue. */
export function prochaineEcheance(echeance: Date, regle: string | null | undefined): Date | null {
  const f = String(regle ?? "").trim() as Frequence;
  if (!FREQUENCES.includes(f)) return null;

  const jours = JOURS[f];
  if (jours !== undefined) {
    return new Date(echeance.getTime() + jours * 86_400_000);
  }
  return ajouterMois(echeance, MOIS[f]!);
}

export interface TacheRecurrente {
  isRecurring?: boolean | null;
  recurrenceRule?: string | null;
  recurrenceEndDate?: Date | string | null;
  dueDate?: Date | string | null;
}

export interface Regeneration {
  /** Faut-il creer une occurrence suivante ? */
  regenerer: boolean;
  /** Echeance de cette occurrence. */
  prochaineEcheance: Date | null;
  /** Pourquoi on ne regenere pas, quand c'est le cas. */
  raison: string | null;
}

function versDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function planifierProchaine(
  tache: TacheRecurrente,
  maintenant: Date = new Date(),
): Regeneration {
  const rien = (raison: string): Regeneration => ({ regenerer: false, prochaineEcheance: null, raison });

  if (!tache.isRecurring) return rien("La tache n'est pas recurrente.");

  const echeance = versDate(tache.dueDate);
  if (!echeance) {
    // Sans echeance, il n'y a rien a faire avancer. Prendre la date du jour
    // ferait deriver la serie vers le moment de l'achevement.
    return rien("La tache recurrente n'a pas de date d'echeance : impossible de calculer la suivante.");
  }

  const premiere = prochaineEcheance(echeance, tache.recurrenceRule);
  if (!premiere) {
    return rien(`Regle de recurrence inconnue : « ${tache.recurrenceRule ?? ""} ».`);
  }

  // On avance jusqu'a depasser le present: une tache terminee avec deux mois
  // de retard ne doit pas engendrer huit occurrences deja en retard.
  let suivante = premiere;
  let garde = 0;
  while (suivante.getTime() <= maintenant.getTime() && garde < 500) {
    const apres = prochaineEcheance(suivante, tache.recurrenceRule);
    if (!apres || apres.getTime() <= suivante.getTime()) break;
    suivante = apres;
    garde += 1;
  }

  const fin = versDate(tache.recurrenceEndDate);
  if (fin && suivante.getTime() > fin.getTime()) {
    return rien("La date de fin de recurrence est atteinte.");
  }

  return { regenerer: true, prochaineEcheance: suivante, raison: null };
}
