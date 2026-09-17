/** Ventilation horaire des appels, et heure de pointe. */

export interface LigneHeure {
  hour: number | string | null;
  total: number | string | null;
  answered: number | string | null;
  missed: number | string | null;
}

export interface Heure {
  hour: number;
  total: number;
  answered: number;
  missed: number;
}

/** 24 heures, dans l'ordre : une heure sans appel est un vrai zero. */
export function repartirParHeure(lignes: LigneHeure[]): Heure[] {
  const hours: Heure[] = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, answered: 0, missed: 0 }));
  for (const l of lignes) {
    const h = Number(l.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) continue;
    hours[h] = { hour: h, total: Number(l.total ?? 0), answered: Number(l.answered ?? 0), missed: Number(l.missed ?? 0) };
  }
  return hours;
}

/** Heure au plus fort volume, ou -1 s'il n'y a rien a comparer. */
export function heureDePointe(distribution: number[]): number {
  let meilleure = -1;
  let max = 0;
  distribution.forEach((v, i) => {
    if (v > max) { max = v; meilleure = i; }
  });
  return meilleure;
}
