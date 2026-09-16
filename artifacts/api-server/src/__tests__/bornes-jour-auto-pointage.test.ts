/**
 * « Aujourd'hui » pour l'auto-pointage : le jour du SALARIE, pas celui du serveur.
 *
 * CE QUE CE CALCUL COMMANDE
 *
 * `google-auto-pointage` importe l'agenda du jour comme POINTAGE : heure
 * d'arrivee, heure de depart, minutes travaillees. Ces lignes alimentent la
 * paie et les quatre surfaces d'evaluation corrigees le 15/09 (#154, #159,
 * #160). Une fenetre decalee n'est donc pas un detail d'affichage.
 *
 * LE DEFAUT MESURE LE 16/09
 *
 *     const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
 *     const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
 *
 * `setHours` travaille dans le fuseau du SERVEUR. Sur Cloud Run, c'est UTC —
 * alors que le fuseau de l'agenda etait lu quelques lignes plus bas, dans
 * `calendarTimeZone`, et transmis a l'API Google. La fenetre interrogee et les
 * evenements rendus n'etaient pas dans le meme referentiel.
 *
 * En ete a Paris (UTC+2), « aujourd'hui » couvrait en realite de 02h00
 * aujourd'hui a 01h59 demain. Les memes bornes servent a la requete
 * anti-doublon sur `checkInAt` : une fenetre decalee pouvait donc aussi
 * manquer le pointage existant et en creer un second.
 *
 * C'est la meme famille que #161, corrige le meme jour dans la
 * synchronisation MANUELLE (`google-calendar-sync.ts`). La regle n'avait ete
 * appliquee que d'un cote — comme le controle d'origine WebSocket (#153), et
 * comme les trois transitions d'etat de l'audit BTP-ULTRA.
 *
 * Les instants choisis ci-dessous ne sont pas decoratifs : ils encadrent
 * minuit et les deux bascules d'heure d'ete, les seuls endroits ou le fuseau
 * change la reponse.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { describe, expect, it } from "vitest";

import { bornesDuJourLocal } from "../services/google-auto-pointage";

/** Heure murale d'un instant dans un fuseau, format `AAAA-MM-JJ HH:mm`. */
function murale(d: Date, tz: string): string {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return f.format(d).replace("T", " ");
}

/** Le calcul FAUTIF, reproduit tel qu'il etait, pour mesurer l'ecart. */
function ancienCalcul(now: Date): { debut: Date; fin: Date } {
  const debut = new Date(now);
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(now);
  fin.setHours(23, 59, 59, 999);
  return { debut, fin };
}

describe("la journee commence a minuit chez le salarie", () => {
  it("en ete a Paris, la borne basse est minuit heure de Paris", () => {
    // 14h00 UTC le 15 juillet = 16h00 a Paris. La journee du salarie a
    // commence a 00h00 Paris, soit 22h00 UTC la veille.
    const { debut } = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), "Europe/Paris");
    expect(murale(debut, "Europe/Paris")).toBe("2026-07-15 00:00");
    expect(debut.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("en hiver a Paris aussi, avec l'autre decalage", () => {
    // Paris est a UTC+1 en hiver : minuit local = 23h00 UTC la veille.
    const { debut } = bornesDuJourLocal(new Date("2026-01-15T14:00:00Z"), "Europe/Paris");
    expect(murale(debut, "Europe/Paris")).toBe("2026-01-15 00:00");
    expect(debut.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("la borne haute est la derniere milliseconde du jour local", () => {
    const { fin } = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), "Europe/Paris");
    expect(murale(fin, "Europe/Paris")).toBe("2026-07-15 23:59");
    expect(fin.getTime() % 1000).toBe(999);
  });

  it("la fenetre dure bien 24 heures un jour ordinaire", () => {
    const { debut, fin } = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), "Europe/Paris");
    expect(fin.getTime() - debut.getTime()).toBe(24 * 3600 * 1000 - 1);
  });
});

describe("l'ecart avec l'ancien calcul est bien celui qui perdait des heures", () => {
  it("les deux premieres heures de la journee parisienne etaient hors fenetre", () => {
    // LE COEUR DU DEFAUT. Ce test ne se contente pas de verifier le nouveau
    // resultat : il montre que l'ancien excluait un instant reellement
    // compris dans la journee du salarie.
    const now = new Date("2026-07-15T14:00:00Z");
    const { debut } = bornesDuJourLocal(now, "Europe/Paris");
    const ancien = ancienCalcul(now);

    // 00h30 heure de Paris le 15 juillet : sans conteste « aujourd'hui ».
    const tot = new Date("2026-07-14T22:30:00Z");
    expect(murale(tot, "Europe/Paris")).toBe("2026-07-15 00:30");

    expect(tot >= debut, "la nouvelle fenetre doit contenir 00h30 Paris").toBe(true);
    // L'ancien calcul dependait du fuseau du processus ; on ne l'affirme donc
    // que lorsque le test tourne en UTC, comme Cloud Run.
    if (new Date().getTimezoneOffset() === 0) {
      expect(tot < ancien.debut, "l'ancien calcul l'excluait").toBe(true);
    }
  });

  it("le nouveau calcul ne depend PAS du fuseau du processus", () => {
    // La propriete qui manquait. Quel que soit l'endroit ou tourne le
    // serveur, la journee du salarie est la meme.
    const now = new Date("2026-07-15T14:00:00Z");
    const a = bornesDuJourLocal(now, "Europe/Paris");
    const ancien = ancienCalcul(now);
    expect(a.debut.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    // Garde-fou : si le processus tourne deja a Paris, les deux coincident et
    // ce fichier ne prouverait rien sans le cas precedent.
    expect(typeof ancien.debut.toISOString()).toBe("string");
  });
});

describe("les bascules d'heure d'ete", () => {
  it("le jour du passage a l'heure d'ete ne dure que 23 heures", () => {
    // 29 mars 2026 : 02h00 devient 03h00 a Paris. Une fenetre de 24 heures
    // mordrait sur le lendemain.
    const { debut, fin } = bornesDuJourLocal(new Date("2026-03-29T12:00:00Z"), "Europe/Paris");
    expect(murale(debut, "Europe/Paris")).toBe("2026-03-29 00:00");
    const heures = (fin.getTime() - debut.getTime() + 1) / 3600000;
    expect(heures).toBe(23);
  });

  it("le jour du retour a l'heure d'hiver en dure 25", () => {
    // 25 octobre 2026 : 03h00 redevient 02h00.
    const { debut, fin } = bornesDuJourLocal(new Date("2026-10-25T12:00:00Z"), "Europe/Paris");
    expect(murale(debut, "Europe/Paris")).toBe("2026-10-25 00:00");
    const heures = (fin.getTime() - debut.getTime() + 1) / 3600000;
    expect(heures).toBe(25);
  });

  it("une bascule qui tombe au milieu de la journee UTC est quand meme correcte", () => {
    // CE CAS A ETE TROUVE PAR MUTATION, pas par lecture.
    //
    // Le calcul corrige le decalage en DEUX passes : la premiere le mesure sur
    // une premiere estimation, la seconde le reevalue au bon instant. Ramener
    // la boucle a une seule passe ne faisait tomber aucun test — il a fallu
    // chercher explicitement un fuseau ou les deux divergent.
    //
    // Auckland en est un. La fin de l'heure d'ete y tombe le 5 avril a 03h00
    // locales, soit en milieu de journee UTC : l'estimation initiale se
    // retrouve du mauvais cote de la bascule.
    //
    // Paris n'en produit aucun — ce que fait ce produit aujourd'hui. Mais le
    // fuseau vient de l'agenda Google du salarie, pas d'une constante.
    const { debut, fin } = bornesDuJourLocal(new Date("2026-04-04T22:00:00Z"), "Pacific/Auckland");
    expect(murale(debut, "Pacific/Auckland")).toBe("2026-04-05 00:00");
    // 00h00 le 5 avril est encore a l'heure d'ete (UTC+13) : 11h00 UTC la
    // veille. Une seule passe rendait 12h00 UTC, soit 01h00 locales.
    expect(debut.toISOString()).toBe("2026-04-04T11:00:00.000Z");
    expect((fin.getTime() - debut.getTime() + 1) / 3600000).toBe(25);
  });

  it("un instant situe juste apres la bascule reste dans le bon jour", () => {
    const { debut, fin } = bornesDuJourLocal(new Date("2026-03-29T01:30:00Z"), "Europe/Paris");
    const t = new Date("2026-03-29T01:30:00Z");
    expect(t >= debut && t <= fin).toBe(true);
  });
});

describe("d'autres fuseaux, et les fuseaux illisibles", () => {
  it("un fuseau tres en avance decale la journee dans l'autre sens", () => {
    // Auckland, UTC+12 : 13h00 UTC le 14 juin, on est deja le 15 sur place.
    const { debut } = bornesDuJourLocal(new Date("2026-06-14T13:00:00Z"), "Pacific/Auckland");
    expect(murale(debut, "Pacific/Auckland")).toBe("2026-06-15 00:00");
  });

  it("un fuseau tres en retard aussi", () => {
    const { debut } = bornesDuJourLocal(new Date("2026-06-15T02:00:00Z"), "America/Los_Angeles");
    expect(murale(debut, "America/Los_Angeles")).toBe("2026-06-14 00:00");
  });

  it("un fuseau absent applique le defaut francais, pas UTC", () => {
    // Un repli UTC redonnerait exactement le defaut qu'on vient de corriger.
    const attendu = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), "Europe/Paris");
    for (const tz of [null, undefined, ""]) {
      const r = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), tz);
      expect(r.debut.toISOString(), `fuseau ${String(tz)}`).toBe(attendu.debut.toISOString());
    }
  });

  it("un fuseau illisible ne fait pas retomber sur UTC", () => {
    const attendu = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), "Europe/Paris");
    const r = bornesDuJourLocal(new Date("2026-07-15T14:00:00Z"), "Zone/Inexistante");
    expect(r.debut.toISOString()).toBe(attendu.debut.toISOString());
    expect(r.debut.toISOString()).not.toBe("2026-07-15T00:00:00.000Z");
  });

  it("un fuseau illisible ne jette pas", () => {
    // L'appelant boucle sur les salaries sans `try` autour de ce calcul : une
    // exception ici emporterait la synchronisation des suivants.
    expect(() => bornesDuJourLocal(new Date(), "n'importe quoi")).not.toThrow();
  });
});
