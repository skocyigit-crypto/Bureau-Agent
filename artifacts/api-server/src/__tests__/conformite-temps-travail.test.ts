/**
 * Les bornes du Code du travail autour d'une journee de chantier.
 *
 * CE QUI ETAIT MESURE LE 16/09
 *
 * `checkins` calculait `totalMinutes` et ne le confrontait a rien. Recherche
 * dans tout le depot : repos quotidien de 11 h — 0 occurrence; duree maximale
 * quotidienne de 10 h — 0; hebdomadaire de 48 h — 0; moyenne de 44 h sur
 * 12 semaines — 0; pause de 20 min — la colonne `breakMinutes` existait, et
 * aucune regle ne la lisait.
 *
 * Une journee de 13 heures sans pause s'enregistrait sans un mot, puis partait
 * en paie et en evaluation de performance.
 *
 * CE QUE CES TESTS EXIGENT
 *
 * Les deux sens. Un controle qui ne se declenche jamais ne protege personne;
 * un controle qui se declenche sur une journee ordinaire finit par etre
 * ignore, et emporte les autres avec lui. Chaque seuil est donc teste sur ses
 * DEUX cotes, a la borne exacte.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";

import {
  DUREE_HEBDO_MAX_H,
  DUREE_HEBDO_MOYENNE_MAX_H,
  DUREE_QUOTIDIENNE_MAX_H,
  PAUSE_MIN_MINUTES,
  REPOS_QUOTIDIEN_MIN_H,
  minutesTravaillees,
  verifierEnchainement,
  verifierJournee,
  verifierMoyenne12Semaines,
  verifierSemaine,
  type Journee,
} from "../services/conformite-temps-travail";

/** Journee de chantier: `h` heures de presence, `pause` minutes deduites. */
function journee(debutIso: string, presenceH: number, pause = 0): Journee {
  const debut = new Date(debutIso);
  return {
    debut,
    fin: new Date(debut.getTime() + presenceH * 3_600_000),
    pauseMinutes: pause,
  };
}

const codes = (c: { code: string }[]) => c.map((x) => x.code);

describe("les seuils retenus sont ceux du Code du travail", () => {
  it("les valeurs elles-memes sont verrouillees", () => {
    // Les chiffres SONT la regle: 11 h au lieu de 10 h serait une autre loi.
    expect(REPOS_QUOTIDIEN_MIN_H).toBe(11);
    expect(DUREE_QUOTIDIENNE_MAX_H).toBe(10);
    expect(DUREE_HEBDO_MAX_H).toBe(48);
    expect(DUREE_HEBDO_MOYENNE_MAX_H).toBe(44);
    expect(PAUSE_MIN_MINUTES).toBe(20);
  });

  it("chaque constat cite son article", () => {
    // Un constat sans reference se discute; avec la reference, il se verifie.
    const c = verifierJournee(journee("2026-09-14T06:00:00Z", 13, 30));
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.article).toMatch(/^L\d{4}-\d+$/);
  });
});

describe("la duree quotidienne", () => {
  it("une journee de 8 h ne declenche rien", () => {
    // Le cas ordinaire, et celui qui coute le plus cher s'il se trompe.
    expect(verifierJournee(journee("2026-09-14T07:00:00Z", 8.5, 30))).toEqual([]);
  });

  it("exactement 10 h de travail effectif passe encore", () => {
    // La borne compte: signaler a 10 h ferait crier au loup sur le maximum
    // parfaitement legal.
    const j = journee("2026-09-14T06:00:00Z", 10.5, 30); // 10 h effectives
    expect(minutesTravaillees(j)).toBe(600);
    expect(codes(verifierJournee(j))).not.toContain("duree-quotidienne");
  });

  it("10 h 30 de travail effectif est signale", () => {
    const j = journee("2026-09-14T06:00:00Z", 11, 30);
    const c = verifierJournee(j);
    expect(codes(c)).toContain("duree-quotidienne");
    expect(c.find((x) => x.code === "duree-quotidienne")!.message).toContain("10,5 h");
  });

  it("les pauses sont bien deduites avant de juger", () => {
    // 11 h de presence avec 1 h 30 de pause = 9 h 30 de travail: legal.
    const j = journee("2026-09-14T06:00:00Z", 11, 90);
    expect(minutesTravaillees(j)).toBe(570);
    expect(codes(verifierJournee(j))).not.toContain("duree-quotidienne");
  });

  it("un pointage encore ouvert ne declenche rien", () => {
    // Le salarie est en train de travailler: rien n'est encore constatable,
    // et signaler un depassement a 10 h 01 pendant qu'il badge serait faux.
    expect(verifierJournee({ debut: new Date("2026-09-14T06:00:00Z"), fin: null, pauseMinutes: 0 })).toEqual([]);
  });
});

describe("la pause de 20 minutes", () => {
  it("5 h 30 de travail sans pause ne declenche rien", () => {
    // En dessous de six heures, aucune pause n'est due.
    expect(codes(verifierJournee(journee("2026-09-14T07:00:00Z", 5.5, 0)))).not.toContain("pause-insuffisante");
  });

  it("exactement 6 h sans pause est signale", () => {
    // Le texte dit « des que le temps de travail quotidien ATTEINT six
    // heures »: la borne est inclusive, et c'est la moitie de la regle.
    expect(codes(verifierJournee(journee("2026-09-14T07:00:00Z", 6, 0)))).toContain("pause-insuffisante");
  });

  it("6 h avec 20 min de pause ne declenche rien", () => {
    const j = journee("2026-09-14T07:00:00Z", 6 + 20 / 60, 20);
    expect(codes(verifierJournee(j))).not.toContain("pause-insuffisante");
  });

  it("6 h avec 15 min de pause est signale, avec le chiffre", () => {
    const j = journee("2026-09-14T07:00:00Z", 6 + 15 / 60, 15);
    const c = verifierJournee(j).find((x) => x.code === "pause-insuffisante");
    expect(c).toBeTruthy();
    expect(c!.message).toContain("15 min");
  });

  it("une longue journee sans pause cumule les deux constats", () => {
    // Ils sont distincts: l'un se corrige en raccourcissant la journee,
    // l'autre en accordant la pause.
    const c = codes(verifierJournee(journee("2026-09-14T06:00:00Z", 12, 0)));
    expect(c).toContain("duree-quotidienne");
    expect(c).toContain("pause-insuffisante");
  });
});

describe("le repos quotidien de 11 heures", () => {
  it("11 h entre deux journees passent", () => {
    // Fin a 18 h, reprise a 5 h le lendemain: exactement 11 h.
    const veille = journee("2026-09-14T07:00:00Z", 11);
    const lendemain = journee("2026-09-15T05:00:00Z", 8);
    expect(verifierEnchainement(veille, lendemain)).toEqual([]);
  });

  it("10 h entre deux journees sont signalees", () => {
    // Le defaut qui ne se voit sur AUCUNE ligne prise isolement: les deux
    // journees sont legales, c'est leur enchainement qui ne l'est pas.
    const veille = journee("2026-09-14T08:00:00Z", 10);
    const lendemain = journee("2026-09-15T04:00:00Z", 8);
    const c = verifierEnchainement(veille, lendemain);
    expect(codes(c)).toContain("repos-quotidien");
    expect(c[0]!.message).toContain("10 h");
  });

  it("une veille encore ouverte ne permet aucun constat", () => {
    const veille: Journee = { debut: new Date("2026-09-14T08:00:00Z"), fin: null, pauseMinutes: 0 };
    expect(verifierEnchainement(veille, journee("2026-09-15T04:00:00Z", 8))).toEqual([]);
  });

  it("des pointages qui se chevauchent ne sont pas un defaut de repos", () => {
    // Un intervalle negatif est une erreur de saisie ou un double pointage.
    // Le nommer « repos insuffisant » enverrait chercher au mauvais endroit.
    const a = journee("2026-09-14T08:00:00Z", 10);
    const b = journee("2026-09-14T12:00:00Z", 4);
    expect(verifierEnchainement(a, b)).toEqual([]);
  });
});

describe("la semaine", () => {
  it("cinq journees de 8 h ne declenchent rien", () => {
    const sem = [0, 1, 2, 3, 4].map((d) => journee(`2026-09-1${4 + d}T07:00:00Z`, 8.5, 30));
    expect(verifierSemaine(sem)).toEqual([]);
  });

  it("exactement 48 h passent encore", () => {
    const sem = [0, 1, 2, 3, 4, 5].map((d) => journee(`2026-09-${14 + d}T06:00:00Z`, 8));
    expect(verifierSemaine(sem)).toEqual([]);
  });

  it("50 h sont signalees", () => {
    const sem = [0, 1, 2, 3, 4].map((d) => journee(`2026-09-1${4 + d}T06:00:00Z`, 10));
    const c = verifierSemaine(sem);
    expect(codes(c)).toContain("duree-hebdomadaire");
    expect(c[0]!.message).toContain("50 h");
  });

  it("une semaine vide ne declenche rien", () => {
    expect(verifierSemaine([])).toEqual([]);
  });
});

describe("la moyenne sur douze semaines", () => {
  it("douze semaines a 44 h passent", () => {
    // La borne exacte, et le plafond le plus facile a franchir sans s'en
    // apercevoir.
    expect(verifierMoyenne12Semaines(Array(12).fill(44))).toEqual([]);
  });

  it("douze semaines a 45 h sont signalees, alors qu'aucune n'est illegale seule", () => {
    // Le coeur de cette regle: 45 h est parfaitement licite une semaine
    // donnee — c'est la repetition qui ne l'est pas.
    expect(verifierSemaine([journee("2026-09-14T06:00:00Z", 45)]).length).toBe(0);
    expect(codes(verifierMoyenne12Semaines(Array(12).fill(45)))).toContain("moyenne-12-semaines");
  });

  it("moins de douze semaines ne permettent aucun constat", () => {
    // Affirmer quoi que ce soit sur onze semaines serait inventer la douzieme.
    expect(verifierMoyenne12Semaines(Array(11).fill(60))).toEqual([]);
  });

  it("la fenetre est glissante : un pic tardif est vu", () => {
    // Douze semaines calmes suivies de douze semaines chargees: un calcul
    // sur la seule premiere fenetre ne verrait rien.
    const serie = [...Array(12).fill(20), ...Array(12).fill(47)];
    expect(codes(verifierMoyenne12Semaines(serie))).toContain("moyenne-12-semaines");
  });

  it("un seul constat, pas un par fenetre", () => {
    // Vingt fenetres en depassement diraient vingt fois la meme chose, et la
    // liste cesserait d'etre lue.
    const serie = Array(30).fill(50);
    expect(verifierMoyenne12Semaines(serie)).toHaveLength(1);
  });
});
