/**
 * Ce que le serveur peut constater d'un pointage, et ce qu'il ne doit pas
 * pretendre savoir.
 *
 * Le pointage etait cru sur parole: `location` arrivait du telephone en chaine
 * libre et le serveur la recopiait, `checkInAt` aussi. Un pointage a des
 * consequences de paie; n'importe qui pouvait en poster un depuis chez lui, a
 * l'heure de son choix, en appelant l'API directement.
 *
 * La reconnaissance faciale visait ce probleme — savoir qui pointe — mais elle
 * ne l'aurait pas resolu: un appel direct a l'API ne passe par aucune camera.
 * Et c'est le seul moyen que l'article 9 du RGPD interdit. Le constat vient
 * donc d'ailleurs: de l'etat de position que le serveur tient lui-meme a jour.
 *
 * Le point le plus important de ce fichier est le troisieme verdict. Un releve
 * manquant n'est PAS une fraude — suivi desactive, application fermee, hors
 * horaires. Confondre « je ne sais pas » avec « il n'y etait pas » accuse
 * quelqu'un a tort sur une donnee de paie, et c'est une erreur plus grave que
 * celle qu'on corrige.
 */
import { describe, expect, it } from "vitest";

import {
  bornerHorodatage,
  constaterPresence,
  FRAICHEUR_MAX_MS,
  RETARD_MAX_MS,
} from "../services/checkin-verification";

const T = new Date("2026-06-02T09:00:00Z");

describe("constat de presence", () => {
  it("constate la presence quand le releve est recent et dans une zone", () => {
    const c = constaterPresence(T, {
      currentGeofenceIds: [7],
      lastAt: new Date(T.getTime() - 60_000),
    });
    expect(c.verdict).toBe("verifie");
    expect(c.geofenceId).toBe(7);
  });

  it("dit « hors zone » quand le releve est recent mais hors de toute zone", () => {
    const c = constaterPresence(T, {
      currentGeofenceIds: [],
      lastAt: new Date(T.getTime() - 60_000),
    });
    expect(c.verdict).toBe("hors_zone");
    expect(c.geofenceId).toBeNull();
  });

  it("dit « inconnu » plutot que d'accuser, quand il n'y a aucun releve", () => {
    // Le cas le plus frequent et le plus mal traite: le suivi peut etre
    // desactive, l'application fermee, ou l'on peut etre hors des horaires de
    // travail — tous parfaitement legitimes.
    expect(constaterPresence(T, null).verdict).toBe("inconnu");
    expect(constaterPresence(T, { currentGeofenceIds: [7], lastAt: null }).verdict).toBe("inconnu");
  });

  it("ne s'appuie pas sur un releve perime", () => {
    const perime = new Date(T.getTime() - FRAICHEUR_MAX_MS - 1000);
    expect(constaterPresence(T, { currentGeofenceIds: [7], lastAt: perime }).verdict).toBe("inconnu");
    // Juste dans la fenetre: le constat tient.
    const limite = new Date(T.getTime() - FRAICHEUR_MAX_MS + 1000);
    expect(constaterPresence(T, { currentGeofenceIds: [7], lastAt: limite }).verdict).toBe("verifie");
  });

  it("ignore des identifiants de zone absurdes", () => {
    // Une valeur corrompue ne doit pas produire un « verifie » avec une zone
    // qui n'existe pas: c'est un constat plus faux qu'un « hors zone ».
    const c = constaterPresence(T, {
      currentGeofenceIds: [0, -3, 1.5] as number[],
      lastAt: new Date(T.getTime() - 1000),
    });
    expect(c.verdict).toBe("hors_zone");
  });
});

describe("bornage de l'horodatage", () => {
  it("refuse une date dans le futur", () => {
    // Pointer son arrivee de demain matin, ce soir.
    const futur = new Date(T.getTime() + 3 * 3600_000);
    const r = bornerHorodatage(futur, T);
    expect(r.retenuDuClient).toBe(false);
    expect(r.instant.getTime()).toBe(T.getTime());
  });

  it("tolere une derive d'horloge d'une minute", () => {
    const r = bornerHorodatage(new Date(T.getTime() + 30_000), T);
    expect(r.retenuDuClient).toBe(true);
  });

  it("accepte un rattrapage hors ligne dans la journee", () => {
    // Un chantier sans reseau: le mobile envoie ses pointages en arrivant.
    const r = bornerHorodatage(new Date(T.getTime() - 3 * 3600_000), T);
    expect(r.retenuDuClient).toBe(true);
    expect(r.instant.getTime()).toBe(T.getTime() - 3 * 3600_000);
  });

  it("refuse un rattrapage au-dela d'une journee", () => {
    const r = bornerHorodatage(new Date(T.getTime() - RETARD_MAX_MS - 1000), T);
    expect(r.retenuDuClient).toBe(false);
    expect(r.instant.getTime()).toBe(T.getTime());
  });

  it("prend l'horloge du serveur quand le client ne dit rien ou dit n'importe quoi", () => {
    expect(bornerHorodatage(undefined, T).instant.getTime()).toBe(T.getTime());
    expect(bornerHorodatage(new Date("pas une date"), T).instant.getTime()).toBe(T.getTime());
  });
});
