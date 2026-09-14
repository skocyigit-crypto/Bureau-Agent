/**
 * Le detecteur de chevauchement doit prevenir quand il faut — et se taire le
 * reste du temps.
 *
 * La seconde moitie compte autant que la premiere. Un agenda professionnel est
 * plein de creneaux qui se suivent bout a bout; si l'outil les signalait, on
 * apprendrait en une journee a fermer l'avertissement sans le lire, et le jour
 * du vrai conflit il serait ferme aussi.
 *
 * Les cas ci-dessous sont ceux d'une semaine de chantier: rendez-vous
 * consecutifs, journee entiere, rendez-vous annule, modification d'un
 * evenement existant.
 */
import { describe, expect, it } from "vitest";

import {
  chevauchements,
  messageChevauchement,
  type CreneauAgenda,
} from "@/lib/chevauchement-agenda";

const J = "2026-09-15";
const creneau = (h: string, f: string | null, extra: Partial<CreneauAgenda> = {}): CreneauAgenda => ({
  startDate: `${J}T${h}:00`,
  endDate: f ? `${J}T${f}:00` : null,
  ...extra,
});

describe("ce qui doit alerter", () => {
  it("deux rendez-vous qui se recouvrent", () => {
    const existants = [creneau("09:00", "10:30", { id: 1, title: "Visite chantier Dupont" })];
    const trouves = chevauchements(creneau("10:00", "11:00"), existants);

    expect(trouves).toHaveLength(1);
    expect(trouves[0].minutesCommunes).toBe(30);
  });

  it("un rendez-vous entierement contenu dans un autre", () => {
    const existants = [creneau("08:00", "18:00", { id: 1, title: "Journee chantier" })];
    const trouves = chevauchements(creneau("10:00", "11:00"), existants);

    expect(trouves).toHaveLength(1);
    expect(trouves[0].minutesCommunes).toBe(60);
  });

  it("classe le plus recouvrant en premier", () => {
    // L'utilisateur doit voir d'abord ce qui gene le plus, pas le premier
    // enregistre.
    const existants = [
      creneau("10:45", "11:00", { id: 1, title: "Appel court" }),
      creneau("10:00", "11:00", { id: 2, title: "Reunion" }),
    ];
    const trouves = chevauchements(creneau("10:00", "11:00"), existants);

    expect(trouves.map((t) => t.existant.id)).toEqual([2, 1]);
  });

  it("un evenement sans heure de fin occupe une heure", () => {
    const existants = [creneau("10:00", null, { id: 1, title: "Passage rapide" })];
    expect(chevauchements(creneau("10:30", "11:30"), existants)).toHaveLength(1);
  });
});

describe("ce qui ne doit PAS alerter", () => {
  it("deux creneaux qui se suivent bout a bout", () => {
    // Le cas le plus frequent d'une journee remplie. Le signaler serait du
    // bruit, et le bruit rend les vraies alertes invisibles.
    const existants = [creneau("09:00", "10:00", { id: 1 })];
    expect(chevauchements(creneau("10:00", "11:00"), existants)).toEqual([]);
  });

  it("un rendez-vous annule", () => {
    const existants = [creneau("10:00", "11:00", { id: 1, status: "annule" })];
    expect(chevauchements(creneau("10:00", "11:00"), existants)).toEqual([]);
  });

  it("un evenement « journee entiere »", () => {
    // Un jalon ou un rappel qui porte sur la journee n'occupe pas d'heure.
    const existants = [creneau("00:00", "23:59", { id: 1, allDay: true })];
    expect(chevauchements(creneau("10:00", "11:00"), existants)).toEqual([]);
  });

  it("l'evenement qu'on est en train de modifier", () => {
    // Sans cette regle, deplacer un rendez-vous de dix minutes le ferait se
    // heurter a lui-meme — et l'avertissement serait toujours faux.
    const existants = [creneau("10:00", "11:00", { id: 7, title: "Lui-meme" })];
    expect(chevauchements(creneau("10:15", "11:15", { id: 7 }), existants)).toEqual([]);
  });

  it("une date illisible ne fait pas crier l'outil", () => {
    expect(chevauchements({ startDate: "pas une date" }, [creneau("10:00", "11:00", { id: 1 })])).toEqual([]);
  });
});

describe("le message rendu a l'utilisateur", () => {
  it("nomme le rendez-vous en travers et donne son heure", () => {
    const trouves = chevauchements(creneau("10:00", "11:00"), [
      creneau("10:00", "10:30", { id: 1, title: "Visite chantier Dupont" }),
    ]);

    const message = messageChevauchement(trouves)!;
    expect(message).toContain("Visite chantier Dupont");
    expect(message).toMatch(/10[:h]00/);
  });

  it("dit combien il y en a quand il y en a plusieurs", () => {
    const trouves = chevauchements(creneau("10:00", "12:00"), [
      creneau("10:00", "11:00", { id: 1, title: "A" }),
      creneau("11:00", "12:00", { id: 2, title: "B" }),
    ]);

    expect(messageChevauchement(trouves)).toContain("2 autres");
  });

  it("ne dit rien quand il n'y a rien a dire", () => {
    expect(messageChevauchement([])).toBeNull();
  });

  it("reste lisible quand l'evenement n'a pas de titre", () => {
    const trouves = chevauchements(creneau("10:00", "11:00"), [
      creneau("10:00", "11:00", { id: 1, title: "   " }),
    ]);
    expect(messageChevauchement(trouves)).toContain("un autre rendez-vous");
  });
});
