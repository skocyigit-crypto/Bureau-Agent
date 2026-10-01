/**
 * LE PLANNING EN TROIS VUES (plan du 29/09, section 7).
 *
 * « Kesif randevusu ile santiye calisma programi ayni tur takvim olayi gibi ele
 * alinmamali. » Avant : un seul calendrier, ou une visite de devis et trois
 * semaines de gros oeuvre etaient le meme objet. Ici trois questions :
 *
 *   - Rendez-vous : qui je vois, quand — les creneaux SANS chantier (visites,
 *     rendez-vous client). Un chantier n'existe pas encore a ce stade.
 *   - Plan d'equipe : qui fait quoi cette semaine, et qui est pris deux fois.
 *   - Plan de travaux : les taches des chantiers, leurs liens « attend la fin
 *     de », et ce qui GLISSE quand une tache prend du retard.
 *
 * Le glissement est CALCULE et PROPOSE, jamais ecrit : deplacer les dates
 * d'une equipe parce qu'une autre est en retard serait decider a sa place.
 * `calculerGlissements` est pure : elle se sonde sans base.
 */
import { calendarEventsTable, db, projetsTable, taskDependancesTable, tasksTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

const JOUR = 86_400_000;

export type TachePlan = {
  id: number;
  titre: string;
  debut: Date | null;
  fin: Date | null;
  statut: string;
  projetId: number | null;
  responsable: string | null;
};

export type Glissement = {
  /** Debut au plus tot compte tenu des taches attendues. */
  debutAuPlusTot: Date | null;
  /** Jours de retard que la tache subit (0 = tient). */
  jours: number;
  /** Les taches attendues qui la font glisser. */
  causes: number[];
};

/**
 * Propage les retards le long des liens « attend la fin de ».
 *
 * Pour chaque tache : debut au plus tot = max(son debut prevu, fin effective de
 * chaque tache attendue). La fin effective d'une tache glissee est decalee du
 * meme nombre de jours (sa duree est conservee). Ordre topologique : une boucle
 * est signalee, jamais parcourue a l'infini.
 *
 * Une tache TERMINEE ne fait plus glisser personne : ses dates sont passees.
 */
export function calculerGlissements(
  taches: TachePlan[],
  liens: Array<{ tacheId: number; dependDe: number }>,
): { glissements: Map<number, Glissement>; boucle: number[] | null } {
  const parId = new Map(taches.map((t) => [t.id, t]));
  const attend = new Map<number, number[]>();
  const enfants = new Map<number, number[]>();
  for (const l of liens) {
    if (!parId.has(l.tacheId) || !parId.has(l.dependDe)) continue;
    (attend.get(l.tacheId) ?? attend.set(l.tacheId, []).get(l.tacheId)!).push(l.dependDe);
    (enfants.get(l.dependDe) ?? enfants.set(l.dependDe, []).get(l.dependDe)!).push(l.tacheId);
  }

  // Kahn : ordre topologique, et detection de boucle.
  const degre = new Map(taches.map((t) => [t.id, (attend.get(t.id) ?? []).length]));
  const file = taches.filter((t) => degre.get(t.id) === 0).map((t) => t.id);
  const ordre: number[] = [];
  while (file.length) {
    const id = file.shift()!;
    ordre.push(id);
    for (const e of enfants.get(id) ?? []) {
      degre.set(e, degre.get(e)! - 1);
      if (degre.get(e) === 0) file.push(e);
    }
  }
  const boucle = ordre.length < taches.length ? taches.map((t) => t.id).filter((id) => !ordre.includes(id)) : null;

  const finEffective = new Map<number, Date | null>();
  const glissements = new Map<number, Glissement>();
  for (const id of ordre) {
    const t = parId.get(id)!;
    let auPlusTot = t.debut;
    const causes: number[] = [];
    for (const p of attend.get(id) ?? []) {
      const tp = parId.get(p)!;
      if (tp.statut === "termine") continue;
      const fp = finEffective.get(p) ?? tp.fin;
      if (fp && (!auPlusTot || fp.getTime() > auPlusTot.getTime())) {
        if (t.debut && fp.getTime() > t.debut.getTime()) causes.push(p);
        auPlusTot = fp;
      }
    }
    const jours = t.debut && auPlusTot ? Math.max(0, Math.ceil((auPlusTot.getTime() - t.debut.getTime()) / JOUR)) : 0;
    const fin = t.fin ? new Date(t.fin.getTime() + jours * JOUR) : null;
    finEffective.set(id, fin);
    glissements.set(id, { debutAuPlusTot: auPlusTot, jours, causes: jours > 0 ? causes : [] });
  }
  return { glissements, boucle };
}

/** Les rendez-vous : creneaux SANS chantier sur la periode. */
export async function vueRendezVous(organisationId: number, du: Date, au: Date) {
  return db.select({
    id: calendarEventsTable.id, titre: calendarEventsTable.title, type: calendarEventsTable.type,
    debut: calendarEventsTable.startDate, fin: calendarEventsTable.endDate, lieu: calendarEventsTable.location,
    contact: calendarEventsTable.contactName, statut: calendarEventsTable.status,
  }).from(calendarEventsTable)
    .where(and(
      eq(calendarEventsTable.organisationId, organisationId),
      isNull(calendarEventsTable.projetId),
      lte(calendarEventsTable.startDate, au),
      gte(calendarEventsTable.endDate, du),
    ))
    .orderBy(calendarEventsTable.startDate)
    .limit(500);
}

export type LigneEquipe = {
  personne: string;
  taches: Array<{ id: number; titre: string; debut: string | null; fin: string | null; projetId: number | null; chantier: string | null }>;
  /** Paires de taches de la meme personne qui se chevauchent. */
  conflits: Array<[number, number]>;
};

/** Le plan d'equipe : par personne, les taches de la periode et leurs chevauchements. */
export async function vueEquipe(organisationId: number, du: Date, au: Date): Promise<LigneEquipe[]> {
  const lignes = await db.select({
    id: tasksTable.id, titre: tasksTable.title, debut: tasksTable.startDate, fin: tasksTable.dueDate,
    responsable: tasksTable.assignedTo, projetId: tasksTable.projetId, chantier: projetsTable.title,
  }).from(tasksTable)
    .leftJoin(projetsTable, and(eq(projetsTable.id, tasksTable.projetId), eq(projetsTable.organisationId, organisationId)))
    .where(and(
      eq(tasksTable.organisationId, organisationId),
      isNotNull(tasksTable.assignedTo),
      or(
        and(isNotNull(tasksTable.startDate), lte(tasksTable.startDate, au), gte(tasksTable.dueDate, du)),
        and(isNull(tasksTable.startDate), gte(tasksTable.dueDate, du), lte(tasksTable.dueDate, au)),
      ),
      inArray(tasksTable.status, ["en_attente", "en_cours"]),
    ))
    .orderBy(tasksTable.startDate)
    .limit(1000);

  const parPersonne = new Map<string, typeof lignes>();
  for (const l of lignes) {
    const k = l.responsable!.trim();
    (parPersonne.get(k) ?? parPersonne.set(k, []).get(k)!).push(l);
  }
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return [...parPersonne.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([personne, ts]) => {
    const conflits: Array<[number, number]> = [];
    const avecDuree = ts.filter((t) => t.debut && t.fin);
    for (let i = 0; i < avecDuree.length; i++) {
      for (let j = i + 1; j < avecDuree.length; j++) {
        const a = avecDuree[i]!, b = avecDuree[j]!;
        if (new Date(a.debut!).getTime() < new Date(b.fin!).getTime() && new Date(b.debut!).getTime() < new Date(a.fin!).getTime()) {
          conflits.push([a.id, b.id]);
        }
      }
    }
    return {
      personne,
      taches: ts.map((t) => ({ id: t.id, titre: t.titre, debut: iso(t.debut), fin: iso(t.fin), projetId: t.projetId, chantier: t.chantier })),
      conflits,
    };
  });
}

/** Le plan de travaux : taches des chantiers, liens, glissements calcules. */
export async function vueTravaux(organisationId: number, projetId?: number) {
  const taches = await db.select({
    id: tasksTable.id, titre: tasksTable.title, debut: tasksTable.startDate, fin: tasksTable.dueDate,
    statut: tasksTable.status, projetId: tasksTable.projetId, responsable: tasksTable.assignedTo,
    chantier: projetsTable.title,
  }).from(tasksTable)
    .innerJoin(projetsTable, and(eq(projetsTable.id, tasksTable.projetId), eq(projetsTable.organisationId, organisationId)))
    .where(and(
      eq(tasksTable.organisationId, organisationId),
      projetId ? eq(tasksTable.projetId, projetId) : isNotNull(tasksTable.projetId),
    ))
    .orderBy(tasksTable.startDate)
    .limit(2000);

  const ids = taches.map((t) => t.id);
  const liens = ids.length
    ? await db.select({ id: taskDependancesTable.id, tacheId: taskDependancesTable.tacheId, dependDe: taskDependancesTable.dependDe })
        .from(taskDependancesTable)
        .where(and(eq(taskDependancesTable.organisationId, organisationId), inArray(taskDependancesTable.tacheId, ids)))
    : [];

  const plan: TachePlan[] = taches.map((t) => ({
    id: t.id, titre: t.titre, debut: t.debut ? new Date(t.debut) : null, fin: t.fin ? new Date(t.fin) : null,
    statut: t.statut, projetId: t.projetId, responsable: t.responsable,
  }));
  const { glissements, boucle } = calculerGlissements(plan, liens);

  return {
    taches: taches.map((t) => {
      const g = glissements.get(t.id);
      return {
        id: t.id, titre: t.titre, statut: t.statut, projetId: t.projetId, chantier: t.chantier, responsable: t.responsable,
        debut: t.debut ? new Date(t.debut).toISOString() : null,
        fin: t.fin ? new Date(t.fin).toISOString() : null,
        attend: liens.filter((l) => l.tacheId === t.id).map((l) => ({ lienId: l.id, tacheId: l.dependDe })),
        glissementJours: g?.jours ?? 0,
        debutAuPlusTot: g?.debutAuPlusTot ? g.debutAuPlusTot.toISOString() : null,
        causes: g?.causes ?? [],
      };
    }),
    boucle,
  };
}

/** Vrai si ajouter « tache attend dependDe » fermerait une boucle. */
export function fermeraitUneBoucle(liens: Array<{ tacheId: number; dependDe: number }>, tacheId: number, dependDe: number): boolean {
  if (tacheId === dependDe) return true;
  // Une boucle se ferme si `tacheId` est deja (directement ou non) attendue par `dependDe`.
  const attend = new Map<number, number[]>();
  for (const l of liens) (attend.get(l.tacheId) ?? attend.set(l.tacheId, []).get(l.tacheId)!).push(l.dependDe);
  const vus = new Set<number>();
  const pile = [dependDe];
  while (pile.length) {
    const x = pile.pop()!;
    if (x === tacheId) return true;
    if (vus.has(x)) continue;
    vus.add(x);
    pile.push(...(attend.get(x) ?? []));
  }
  return false;
}
