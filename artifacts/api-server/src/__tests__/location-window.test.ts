/**
 * Quand le suivi de presence a le droit de tourner.
 *
 * Le suivi tournait 24 heures sur 24 — la nuit, le dimanche, en conges. La
 * CNIL admet la geolocalisation d'un salarie lorsqu'elle est proportionnee au
 * but poursuivi, mais pas comme moyen de le surveiller en dehors de son temps
 * de travail. Savoir sur quel chantier se trouve une equipe a 10 h et savoir
 * ou dort un salarie a 23 h ne relevent pas de la meme finalite.
 *
 * Ces tests tiennent la borne. Deux proprietes comptent plus que les autres:
 *
 *   - une configuration illisible FERME la fenetre. Une virgule de travers ne
 *     doit pas rouvrir une surveillance permanente — c'est exactement le
 *     defaut qu'on corrige, et il reviendrait par la porte de derriere;
 *   - le fuseau de l'organisation fait foi. Le serveur tourne en UTC:
 *     comparer une heure UTC a « 07:00-20:00 » aurait decale la fenetre de
 *     deux heures l'ete, arretant le suivi a 18 h locale et le rouvrant a 5 h
 *     du matin.
 */
import { describe, expect, it } from "vitest";

import { dansLaFenetre, type FenetreSuivi } from "../services/location-window";

/** Le defaut livre: BTP, large mais borne. */
const DEFAUT: FenetreSuivi = {
  jours: "1,2,3,4,5,6",
  debut: "07:00",
  fin: "20:00",
  fuseau: "Europe/Paris",
};

/** Un instant donne en heure de PARIS, converti en UTC par la plateforme. */
function paris(iso: string): Date {
  // Les dates de ce fichier sont ecrites en heure locale francaise; on passe
  // par un decalage explicite pour ne pas dependre du fuseau de la machine
  // qui execute les tests (la CI tourne en UTC, un poste de dev non).
  return new Date(iso);
}

describe("fenetre de suivi de presence", () => {
  it("laisse passer une journee de travail ordinaire", () => {
    // Mardi 2 juin 2026, 10:00 heure de Paris (UTC+2 en ete).
    expect(dansLaFenetre(paris("2026-06-02T08:00:00Z"), DEFAUT)).toBe(true);
  });

  it("refuse la nuit", () => {
    // Mardi 2 juin, 23:00 a Paris. Le cas qui donnait « ou dort un salarie ».
    expect(dansLaFenetre(paris("2026-06-02T21:00:00Z"), DEFAUT)).toBe(false);
    // Mercredi 3 juin, 03:00 a Paris.
    expect(dansLaFenetre(paris("2026-06-03T01:00:00Z"), DEFAUT)).toBe(false);
  });

  it("refuse le dimanche, meme en pleine journee", () => {
    // Dimanche 7 juin 2026, 10:00 a Paris.
    expect(dansLaFenetre(paris("2026-06-07T08:00:00Z"), DEFAUT)).toBe(false);
  });

  it("accepte le samedi, parce que le batiment y travaille", () => {
    // Samedi 6 juin 2026, 09:00 a Paris.
    expect(dansLaFenetre(paris("2026-06-06T07:00:00Z"), DEFAUT)).toBe(true);
  });

  it("lit l'heure dans le fuseau de l'organisation, pas en UTC", () => {
    // Mardi 2 juin, 19:30 a Paris = 17:30 UTC. En comparant l'heure UTC a la
    // fenetre, on aurait vu 17:30 et laisse passer — mais on aurait AUSSI
    // laisse passer 21:30 locale (19:30 UTC). Ce test fixe le cas qui separe
    // les deux lectures.
    expect(dansLaFenetre(paris("2026-06-02T17:30:00Z"), DEFAUT)).toBe(true);
    // 21:30 a Paris, soit 19:30 UTC: dans la fenetre si on lit l'UTC, hors
    // fenetre en realite.
    expect(dansLaFenetre(paris("2026-06-02T19:30:00Z"), DEFAUT)).toBe(false);
  });

  it("exclut la borne haute", () => {
    // 20:00 pile a Paris: la journee est finie.
    expect(dansLaFenetre(paris("2026-06-02T18:00:00Z"), DEFAUT)).toBe(false);
    // 19:59 passe encore.
    expect(dansLaFenetre(paris("2026-06-02T17:59:00Z"), DEFAUT)).toBe(true);
  });

  it("inclut la borne basse", () => {
    // 07:00 pile: la journee commence.
    expect(dansLaFenetre(paris("2026-06-02T05:00:00Z"), DEFAUT)).toBe(true);
    // 06:59: pas encore.
    expect(dansLaFenetre(paris("2026-06-02T04:59:00Z"), DEFAUT)).toBe(false);
  });

  it("ferme la fenetre quand la configuration est illisible", () => {
    // Le point le plus important du fichier: une saisie de travers ne doit
    // PAS rouvrir la surveillance permanente.
    const cassees: Partial<FenetreSuivi>[] = [
      { debut: "" },
      { debut: "7h" },
      { fin: "25:00" },
      { fin: "07:60" },
      { jours: "" },
      { jours: "lundi,mardi" },
      { jours: "0,8,9" },
      { fuseau: "Mars/Olympus" },
    ];
    for (const patch of cassees) {
      const config = { ...DEFAUT, ...patch };
      expect(
        dansLaFenetre(paris("2026-06-02T08:00:00Z"), config),
        `configuration ${JSON.stringify(patch)} ne doit pas ouvrir la surveillance`,
      ).toBe(false);
    }
  });

  it("refuse une fenetre inversee au lieu de l'interpreter", () => {
    // « 20:00 -> 07:00 » ressemble a une surveillance de nuit. On ne devine
    // pas une intention pareille: on refuse.
    const inversee = { ...DEFAUT, debut: "20:00", fin: "07:00" };
    expect(dansLaFenetre(paris("2026-06-02T21:00:00Z"), inversee)).toBe(false);
    expect(dansLaFenetre(paris("2026-06-02T08:00:00Z"), inversee)).toBe(false);
  });

  it("respecte une fenetre plus etroite choisie par l'employeur", () => {
    const bureau: FenetreSuivi = { jours: "1,2,3,4,5", debut: "09:00", fin: "17:00", fuseau: "Europe/Paris" };
    expect(dansLaFenetre(paris("2026-06-02T08:00:00Z"), bureau)).toBe(true);  // 10:00
    expect(dansLaFenetre(paris("2026-06-02T16:00:00Z"), bureau)).toBe(false); // 18:00
    expect(dansLaFenetre(paris("2026-06-06T09:00:00Z"), bureau)).toBe(false); // samedi
  });

  it("suit le changement d'heure sans decalage", () => {
    // 2 janvier 2026, 19:30 a Paris (UTC+1 en hiver) = 18:30 UTC. Une fenetre
    // codee sur un decalage fixe se serait trompee d'une heure a chaque
    // changement d'heure — deux fois par an, sur une regle qui decide d'une
    // surveillance.
    expect(dansLaFenetre(new Date("2026-01-02T18:30:00Z"), DEFAUT)).toBe(true);
    expect(dansLaFenetre(new Date("2026-01-02T19:30:00Z"), DEFAUT)).toBe(false);
  });
});
