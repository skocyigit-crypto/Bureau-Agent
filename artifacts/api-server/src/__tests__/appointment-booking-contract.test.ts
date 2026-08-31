import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reservation de rendez-vous: garder la section critique courte.
 *
 * Deux clients differents peuvent confirmer des creneaux qui se chevauchent au
 * meme instant. La protection est un verrou avisoire par organisation, pris
 * dans la transaction: il serialise les reservations le temps de re-verifier
 * la disponibilite puis d'ecrire l'evenement.
 *
 * Ce qui etait re-verifie sous ce verrou allait bien au-dela: `isSlotFree()`
 * interroge aussi les fermetures, les horaires d'ouverture et — surtout —
 * l'agenda Google par un appel reseau. Une section critique de quelques
 * millisecondes devenait donc aussi longue qu'un appel HTTP lent, pendant
 * lequel les autres confirmations de la meme organisation attendaient le
 * verrou sans lacher leur connexion. `isSlotFree()` en demandait deux de plus
 * sur un pool borne a 15: le detenteur du verrou pouvait attendre une
 * connexion que les bloques ne rendraient jamais, figeant tout l'acces base de
 * l'application — pas seulement les rendez-vous. Ce depot a deja mesure une
 * saturation de ce pool en production.
 *
 * Le decoupage retenu: verification complete AVANT la transaction, et sous le
 * verrou uniquement ce que la concurrence peut changer, l'evenement d'agenda
 * qui chevauche. Aucune garantie n'est perdue — fermetures et horaires sont de
 * la configuration, et l'agenda Google est externe, qu'aucun verrou local ne
 * fige.
 */

const source = readFileSync(
  join(import.meta.dirname, "..", "services", "appointment-offers.ts"),
  "utf8",
);

/** Corps de chaque `db.transaction(...)`, par appariement d'accolades. */
function transactionBodies(src: string): string[] {
  const bodies: string[] = [];
  const marker = "db.transaction(";
  let from = 0;
  for (;;) {
    const at = src.indexOf(marker, from);
    if (at === -1) break;
    let depth = 0;
    let i = src.indexOf("{", at);
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    bodies.push(src.slice(start, i + 1));
    from = i;
  }
  return bodies;
}

const bodies = transactionBodies(source);

describe("section critique de reservation", () => {
  it("couvre les deux chemins qui reservent un creneau", () => {
    // Confirmation et reprogrammation: les deux ecrivent dans l'agenda.
    expect(bodies.length).toBeGreaterThanOrEqual(2);
  });

  it("prend toujours le verrou par organisation", () => {
    // Sans lui, deux offres distinctes sur des creneaux qui se chevauchent
    // passent la verification en concurrence et reservent toutes les deux.
    for (const body of bodies) {
      expect(body).toContain("pg_advisory_xact_lock");
    }
  });

  it("n'appelle plus isSlotFree sous le verrou", () => {
    // La regression exacte: un appel reseau a Google dans la transaction.
    for (const body of bodies) {
      expect(body).not.toMatch(/\bisSlotFree\(/);
    }
  });

  it("re-verifie le chevauchement dans la transaction", () => {
    // La verification hors transaction ne suffit pas: entre elle et l'ecriture,
    // une autre confirmation peut avoir reserve le creneau.
    const booking = bodies.filter((b) => b.includes("pg_advisory_xact_lock"));
    for (const body of booking) {
      expect(body).toMatch(/hasOverlappingEvent\(\s*tx,/);
    }
  });

  it("garde la verification complete avant la transaction", () => {
    // Fermetures, horaires et agenda Google restent verifies: le decoupage
    // deplace ces controles, il ne les supprime pas.
    expect(source).toMatch(/const free = await isSlotFree\(/);
    expect(source.match(/await isSlotFree\(/g) ?? []).toHaveLength(2);
  });

  it("ne fait aucun appel reseau dans la transaction", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/\bfetch\(|\baxios\b|freebusy|sendEmail\(|providerSendSms\(/);
    }
  });
});

describe("re-verification etroite", () => {
  const helper = source.slice(
    source.indexOf("async function hasOverlappingEvent"),
    source.indexOf("async function hasOverlappingEvent") + 900,
  );

  it("garde la semantique de localBusyIntervals", () => {
    // Un evenement annule ou une journee entiere ne bloque pas un creneau
    // horaire: les compter ferait refuser des creneaux pourtant libres.
    expect(helper).toMatch(/ne\(calendarEventsTable\.status, "annule"\)/);
    expect(helper).toMatch(/eq\(calendarEventsTable\.allDay, false\)/);
  });

  it("reste bornee a l'organisation", () => {
    expect(helper).toMatch(/eq\(calendarEventsTable\.organisationId, orgId\)/);
  });

  it("teste bien un chevauchement", () => {
    expect(helper).toMatch(/lt\(calendarEventsTable\.startDate, end\)/);
    expect(helper).toMatch(/gt\(calendarEventsTable\.endDate, start\)/);
  });
});
