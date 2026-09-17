/**
 * Une tache recurrente qui ne revenait jamais.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `tasks` porte `isRecurring`, `recurrenceRule` et `recurrenceEndDate`.
 * L'interface offre six frequences — quotidien, hebdomadaire, bihebdomadaire,
 * mensuel, trimestriel, annuel — plus une date de fin, et le guide utilisateur
 * documente la fonction.
 *
 * Dans tout le serveur, ces trois colonnes n'etaient lues qu'a UN endroit :
 * l'export CSV, pour ecrire « Oui » ou « Non » dans une colonne. Aucun
 * traitement, aucun cron, aucun declencheur a l'achevement.
 *
 * L'utilisateur coche « chaque lundi », termine la tache une fois, et elle ne
 * revient jamais. Une promesse de l'interface que rien ne tient — meme forme
 * que la politique de conservation annoncee sans traitement, ou que la
 * notification de violation promise au contrat sans mecanisme.
 *
 * LES DEUX PIEGES DE DATE, TESTES ICI
 *
 * 1. L'ANCRAGE. Calculer la suivante depuis la date d'ACHEVEMENT ferait
 *    deriver la serie : une tache hebdomadaire terminee avec trois jours de
 *    retard decalerait toutes les suivantes de trois jours, puis de six, et
 *    « chaque lundi » finirait un jeudi. L'ancre est l'echeance.
 *
 * 2. LA FIN DE MOIS. `setMonth` deborde : le 31 janvier + 1 mois donne le
 *    3 mars, parce que fevrier n'a pas 31 jours. Une tache mensuelle creee un
 *    31 sauterait fevrier et deriverait a chaque passage.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import { FREQUENCES, planifierProchaine, prochaineEcheance } from "../services/taches-recurrentes";

const j = (iso: string) => new Date(iso);
const jour = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("les six frequences de l'interface", () => {
  it("la liste correspond exactement a ce que l'interface propose", () => {
    // Si l'interface en ajoute une, ce test le signale avant qu'un
    // utilisateur ne coche une option qui ne fait rien — le defaut meme
    // qu'on corrige.
    expect([...FREQUENCES]).toEqual([
      "quotidien", "hebdomadaire", "bihebdomadaire", "mensuel", "trimestriel", "annuel",
    ]);
  });

  it("quotidien avance d'un jour", () => {
    expect(jour(prochaineEcheance(j("2026-03-10T09:00:00Z"), "quotidien"))).toBe("2026-03-11");
  });

  it("hebdomadaire avance de sept jours", () => {
    expect(jour(prochaineEcheance(j("2026-03-10T09:00:00Z"), "hebdomadaire"))).toBe("2026-03-17");
  });

  it("bihebdomadaire avance de quatorze jours", () => {
    expect(jour(prochaineEcheance(j("2026-03-10T09:00:00Z"), "bihebdomadaire"))).toBe("2026-03-24");
  });

  it("mensuel, trimestriel et annuel avancent en mois", () => {
    expect(jour(prochaineEcheance(j("2026-03-10T09:00:00Z"), "mensuel"))).toBe("2026-04-10");
    expect(jour(prochaineEcheance(j("2026-03-10T09:00:00Z"), "trimestriel"))).toBe("2026-06-10");
    expect(jour(prochaineEcheance(j("2026-03-10T09:00:00Z"), "annuel"))).toBe("2027-03-10");
  });

  it("l'heure de l'echeance est conservee", () => {
    // Une tache due a 9 h ne doit pas devenir due a minuit.
    const d = prochaineEcheance(j("2026-03-10T09:30:00Z"), "hebdomadaire");
    expect(d?.toISOString()).toBe("2026-03-17T09:30:00.000Z");
  });

  it("une regle inconnue ne produit pas de date inventee", () => {
    // Mieux vaut ne rien regenerer que poser une echeance arbitraire.
    expect(prochaineEcheance(j("2026-03-10T09:00:00Z"), "tous_les_mardis")).toBeNull();
    expect(prochaineEcheance(j("2026-03-10T09:00:00Z"), null)).toBeNull();
    expect(prochaineEcheance(j("2026-03-10T09:00:00Z"), "")).toBeNull();
  });
});

describe("la fin de mois, qui est le piege classique", () => {
  it("le 31 janvier + 1 mois donne le 28 fevrier, pas le 3 mars", () => {
    // `setMonth` naif deborde sur mars. Une tache mensuelle creee un 31
    // sauterait fevrier et deriverait a chaque passage.
    expect(jour(prochaineEcheance(j("2026-01-31T09:00:00Z"), "mensuel"))).toBe("2026-02-28");
  });

  it("une annee bissextile donne le 29", () => {
    expect(jour(prochaineEcheance(j("2028-01-31T09:00:00Z"), "mensuel"))).toBe("2028-02-29");
  });

  it("le 31 mars + 1 mois donne le 30 avril", () => {
    expect(jour(prochaineEcheance(j("2026-03-31T09:00:00Z"), "mensuel"))).toBe("2026-04-30");
  });

  it("le 31 decembre + 1 mois change d'annee correctement", () => {
    expect(jour(prochaineEcheance(j("2026-12-31T09:00:00Z"), "mensuel"))).toBe("2027-01-31");
  });

  it("le 29 fevrier + 1 an tombe le 28", () => {
    expect(jour(prochaineEcheance(j("2028-02-29T09:00:00Z"), "annuel"))).toBe("2029-02-28");
  });
});

describe("ce qui declenche une regeneration, et ce qui ne la declenche pas", () => {
  const MAINTENANT = j("2026-03-10T12:00:00Z");
  const BASE = {
    isRecurring: true,
    recurrenceRule: "hebdomadaire",
    dueDate: "2026-03-10T09:00:00Z",
  };

  it("une tache recurrente engendre la suivante", () => {
    const p = planifierProchaine(BASE, MAINTENANT);
    expect(p.regenerer).toBe(true);
    expect(jour(p.prochaineEcheance)).toBe("2026-03-17");
  });

  it("une tache NON recurrente n'engendre rien", () => {
    const p = planifierProchaine({ ...BASE, isRecurring: false }, MAINTENANT);
    expect(p.regenerer).toBe(false);
    expect(p.raison).toMatch(/pas recurrente/i);
  });

  it("une regle inconnue est nommee plutot que silencieuse", () => {
    // L'utilisateur doit pouvoir comprendre pourquoi sa tache ne revient pas.
    const p = planifierProchaine({ ...BASE, recurrenceRule: "chaque pleine lune" }, MAINTENANT);
    expect(p.regenerer).toBe(false);
    expect(p.raison).toMatch(/inconnue/i);
  });

  it("une tache sans echeance ne peut pas etre planifiee", () => {
    // Prendre la date du jour ferait deriver la serie vers le moment de
    // l'achevement — exactement ce qu'on cherche a eviter.
    const p = planifierProchaine({ ...BASE, dueDate: null }, MAINTENANT);
    expect(p.regenerer).toBe(false);
    expect(p.raison).toMatch(/echeance/i);
  });

  it("une echeance illisible non plus", () => {
    const p = planifierProchaine({ ...BASE, dueDate: "pas-une-date" }, MAINTENANT);
    expect(p.regenerer).toBe(false);
  });
});

describe("l'ancrage sur l'echeance, pas sur l'achevement", () => {
  it("une tache terminee en retard garde le rythme d'origine", () => {
    // LE PREMIER PIEGE. Echeance le mardi 10, terminee le vendredi 13 :
    // la suivante reste le mardi 17, pas le vendredi 20.
    const p = planifierProchaine(
      { isRecurring: true, recurrenceRule: "hebdomadaire", dueDate: "2026-03-10T09:00:00Z" },
      j("2026-03-13T18:00:00Z"),
    );
    expect(jour(p.prochaineEcheance)).toBe("2026-03-17");
  });

  it("une tache terminee tres en retard ne produit pas une occurrence deja passee", () => {
    // Deux mois de retard sur une tache hebdomadaire engendreraient huit
    // occurrences en retard si l'on se contentait d'ajouter sept jours.
    const p = planifierProchaine(
      { isRecurring: true, recurrenceRule: "hebdomadaire", dueDate: "2026-01-06T09:00:00Z" },
      j("2026-03-10T12:00:00Z"),
    );
    expect(p.regenerer).toBe(true);
    expect(p.prochaineEcheance!.getTime()).toBeGreaterThan(j("2026-03-10T12:00:00Z").getTime());
    // Le jour de la semaine est conserve: le 6 janvier 2026 est un mardi.
    expect(p.prochaineEcheance!.getUTCDay()).toBe(j("2026-01-06T09:00:00Z").getUTCDay());
  });

  it("une tache terminee EN AVANCE garde aussi son echeance suivante", () => {
    // Terminee le 8 pour une echeance le 10: la suivante reste le 17.
    const p = planifierProchaine(
      { isRecurring: true, recurrenceRule: "hebdomadaire", dueDate: "2026-03-10T09:00:00Z" },
      j("2026-03-08T10:00:00Z"),
    );
    expect(jour(p.prochaineEcheance)).toBe("2026-03-17");
  });
});

describe("la date de fin de recurrence", () => {
  const MAINTENANT = j("2026-03-10T12:00:00Z");

  it("une occurrence avant la fin est engendree", () => {
    const p = planifierProchaine({
      isRecurring: true, recurrenceRule: "hebdomadaire",
      dueDate: "2026-03-10T09:00:00Z", recurrenceEndDate: "2026-12-31T00:00:00Z",
    }, MAINTENANT);
    expect(p.regenerer).toBe(true);
  });

  it("une occurrence APRES la fin ne l'est pas", () => {
    const p = planifierProchaine({
      isRecurring: true, recurrenceRule: "hebdomadaire",
      dueDate: "2026-03-10T09:00:00Z", recurrenceEndDate: "2026-03-15T00:00:00Z",
    }, MAINTENANT);
    expect(p.regenerer).toBe(false);
    expect(p.raison).toMatch(/fin de recurrence/i);
  });

  it("sans date de fin, la serie continue", () => {
    const p = planifierProchaine({
      isRecurring: true, recurrenceRule: "annuel", dueDate: "2026-03-10T09:00:00Z",
    }, MAINTENANT);
    expect(p.regenerer).toBe(true);
  });

  it("une date de fin illisible ne bloque pas la serie", () => {
    // Prudence inverse: une valeur corrompue ne doit pas arreter en silence
    // une recurrence que l'utilisateur croit active.
    const p = planifierProchaine({
      isRecurring: true, recurrenceRule: "hebdomadaire",
      dueDate: "2026-03-10T09:00:00Z", recurrenceEndDate: "n'importe quoi",
    }, MAINTENANT);
    expect(p.regenerer).toBe(true);
  });
});

describe("la regeneration est branchee sur l'achevement", () => {
  async function source(): Promise<string> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(import.meta.dirname, "..", "routes", "tasks.ts"), "utf8");
  }

  it("le PATCH cree l'occurrence suivante quand le statut passe a termine", async () => {
    const s = await source();
    expect(s).toContain("taches-recurrentes");
    expect(s).toContain('if (parsed.data.status === "termine")');
    expect(s).toContain("planifierProchaine(task)");
  });

  it("la nouvelle occurrence reste recurrente", async () => {
    // Sinon la serie s'arreterait a la deuxieme occurrence — un defaut plus
    // difficile a voir que l'absence totale de recurrence.
    const s = await source();
    const i = s.indexOf("db.insert(tasksTable).values({", s.indexOf("planifierProchaine(task)"));
    const bloc = s.slice(i, i + 700);
    expect(bloc).toContain("isRecurring: true");
    expect(bloc).toContain("recurrenceRule: task.recurrenceRule");
    expect(bloc).toContain("recurrenceEndDate: task.recurrenceEndDate");
  });

  it("la nouvelle occurrence n'est pas creee comme terminee", async () => {
    const s = await source();
    const i = s.indexOf("db.insert(tasksTable).values({", s.indexOf("planifierProchaine(task)"));
    expect(s.slice(i, i + 700)).toContain('status: "en_attente"');
  });

  it("un echec de creation n'annule pas l'achevement", async () => {
    // La tache vient d'etre terminee: echouer ici pour un probleme de
    // planification annulerait un achevement legitime.
    const s = await source();
    const i = s.indexOf("occurrence suivante non creee");
    expect(i).toBeGreaterThan(0);
    const bloc = s.slice(Math.max(0, i - 400), i + 120);
    expect(bloc).toContain("log.error");
    expect(bloc).not.toContain("res.status(500)");
  });

  it("la creation est bornee a l'organisation", async () => {
    const s = await source();
    const i = s.indexOf("db.insert(tasksTable).values({", s.indexOf("planifierProchaine(task)"));
    expect(s.slice(i, i + 200)).toContain("organisationId: orgId");
  });
});
