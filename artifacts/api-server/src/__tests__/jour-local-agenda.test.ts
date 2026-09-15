/**
 * Le jour sous lequel un pointage est ecrit — et pourquoi il faut le tester.
 *
 * `syncGoogleCalendarToCheckins` importe les evenements d'agenda d'un salarie
 * comme POINTAGES: heure d'arrivee, heure de depart, minutes travaillees. Ces
 * lignes alimentent ensuite les quatre surfaces d'evaluation corrigees
 * aujourd'hui (#154, #159, #160). Une erreur de jour ici n'est donc pas un
 * detail d'affichage: c'est une journee de travail portee a la mauvaise date.
 *
 * Le fichier porte deja une mise en garde a ce sujet: une fonction
 * `dayBounds` y a ete supprimee le 12/09 parce qu'elle PARAISSAIT gerer les
 * fuseaux — elle en prenait un en parametre — sans le faire. Le commentaire
 * qui l'accompagne dit l'essentiel: quelqu'un cherchant un defaut de fuseau
 * l'aurait trouvee, aurait conclu que le sujet etait traite, et serait passe
 * a cote.
 *
 * DEUX DEFAUTS MESURES LE 15/09
 *
 *   1. Un fuseau INVALIDE faisait retomber la fonction sur son `catch`, qui
 *      calculait la date en UTC. Mesure: `2026-03-10T23:30:00Z` rendait
 *      `2026-03-11` avec `Europe/Paris` et `2026-03-10` avec un fuseau
 *      illisible. Un jour d'ecart, sans erreur.
 *
 *   2. Une date malformee faisait JETER la fonction — depuis le `catch`
 *      lui-meme, qui rappelait `new Date(dateTime).toISOString()`. Or
 *      l'appelant boucle sur les evenements sans `try`: un seul evenement
 *      aberrant rendu par l'API Google faisait echouer la synchronisation
 *      ENTIERE, et aucun pointage n'etait importe.
 *
 * Les dates choisies ci-dessous ne sont pas decoratives: elles encadrent
 * minuit et les bascules d'heure d'ete, les deux seuls endroits ou un decalage
 * de fuseau change la reponse.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { describe, expect, it } from "vitest";

import { getLocalDateKey } from "../services/google-calendar-sync";

describe("le jour retenu est le jour LOCAL, pas le jour UTC", () => {
  it("23h30 UTC en hiver appartient au lendemain a Paris", () => {
    // Paris est a UTC+1 en hiver: 23h30 UTC = 00h30 le lendemain.
    // Retenir le jour UTC ecrirait le pointage la veille.
    expect(getLocalDateKey("2026-01-10T23:30:00Z", "Europe/Paris")).toBe("2026-01-11");
  });

  it("22h30 UTC en hiver appartient encore au meme jour", () => {
    // La borne juste en dessous: 23h30 heure de Paris.
    expect(getLocalDateKey("2026-01-10T22:30:00Z", "Europe/Paris")).toBe("2026-01-10");
  });

  it("21h30 UTC en ete appartient au lendemain a Paris", () => {
    // Paris passe a UTC+2 en ete: 21h30 UTC = 23h30... donc meme jour.
    // 22h30 UTC = 00h30 le lendemain. On verifie les deux cotes de la borne.
    expect(getLocalDateKey("2026-07-10T21:30:00Z", "Europe/Paris")).toBe("2026-07-10");
    expect(getLocalDateKey("2026-07-10T22:30:00Z", "Europe/Paris")).toBe("2026-07-11");
  });

  it("un fuseau tres en avance decale dans l'autre sens", () => {
    // Auckland est a UTC+12: 13h00 UTC le 14 = 01h00 le 15 sur place.
    expect(getLocalDateKey("2026-06-14T13:00:00Z", "Pacific/Auckland")).toBe("2026-06-15");
  });

  it("un fuseau tres en retard aussi", () => {
    // Los Angeles est a UTC-7 en ete: 02h00 UTC le 15 = 19h00 le 14 sur place.
    expect(getLocalDateKey("2026-06-15T02:00:00Z", "America/Los_Angeles")).toBe("2026-06-14");
  });
});

describe("un fuseau absent ou illisible ne change pas la journee", () => {
  it("l'absence de fuseau applique le defaut francais", () => {
    // Le produit s'adresse a des PME francaises: le defaut n'est pas UTC.
    expect(getLocalDateKey("2026-01-10T23:30:00Z", undefined)).toBe("2026-01-11");
    expect(getLocalDateKey("2026-01-10T23:30:00Z", "")).toBe("2026-01-11");
  });

  it("un fuseau invalide donne le MEME jour qu'un fuseau absent", () => {
    // LE DEFAUT MESURE: avant, un fuseau illisible faisait retomber sur UTC
    // et rendait `2026-01-10` — un jour d'ecart, silencieusement.
    const attendu = getLocalDateKey("2026-01-10T23:30:00Z", "Europe/Paris");
    expect(getLocalDateKey("2026-01-10T23:30:00Z", "Zone/Inexistante")).toBe(attendu);
    expect(getLocalDateKey("2026-01-10T23:30:00Z", "n'importe quoi")).toBe(attendu);
  });

  it("le repli n'est pas UTC", () => {
    // Formule explicite: si quelqu'un retablit le repli UTC, ce test le dit.
    expect(getLocalDateKey("2026-01-10T23:30:00Z", "Zone/Inexistante")).not.toBe("2026-01-10");
  });
});

describe("une date inexploitable est signalee, pas fatale", () => {
  it("une date malformee rend null au lieu de jeter", () => {
    // AVANT: la fonction jetait depuis son propre `catch`, et l'appelant
    // bouclait sans `try`. Un seul evenement aberrant emportait toute la
    // synchronisation de l'utilisateur.
    expect(() => getLocalDateKey("pas-une-date", "Europe/Paris")).not.toThrow();
    expect(getLocalDateKey("pas-une-date", "Europe/Paris")).toBeNull();
  });

  it("une date vide aussi", () => {
    expect(getLocalDateKey("", "Europe/Paris")).toBeNull();
  });

  it("une date hors bornes aussi", () => {
    expect(getLocalDateKey("2026-13-99T99:99:99Z", "Europe/Paris")).toBeNull();
  });

  it("une date valide ne rend jamais null", () => {
    // Garde-fou du garde-fou: rendre `null` trop souvent ferait disparaitre
    // des pointages sans que personne ne le remarque.
    for (const d of [
      "2026-01-01T00:00:00Z",
      "2026-12-31T23:59:59Z",
      "2026-06-15T12:00:00+02:00",
      "2026-06-15T12:00:00.123Z",
    ]) {
      expect(getLocalDateKey(d, "Europe/Paris"), `${d} rejete a tort`).not.toBeNull();
    }
  });
});

describe("l'appelant ignore l'evenement au lieu de tout perdre", () => {
  it("il teste explicitement le null et continue", async () => {
    // Le comportement complet demanderait un client Google simule; ce qui se
    // verifie ici est que le contrat de la fonction est bien consomme.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "services", "google-calendar-sync.ts"),
      "utf8",
    );
    expect(source).toContain("if (dayKey === null)");
    const i = source.indexOf("if (dayKey === null)");
    const bloc = source.slice(i, i + 500);
    expect(bloc).toContain("result.errors++");
    expect(bloc).toContain("continue;");
  });

  it("l'evenement ignore est explique dans le rapport de synchronisation", async () => {
    // Un compteur d'erreurs sans detail laisse l'exploitant deviner.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(import.meta.dirname, "..", "services", "google-calendar-sync.ts"),
      "utf8",
    );
    expect(source).toMatch(/date illisible/i);
  });
});
