/**
 * Reservation de rendez-vous verifiee DE BOUT EN BOUT contre la base.
 *
 * La garantie qui compte ici ne se lit pas dans le code: deux clients
 * differents ne doivent pas pouvoir reserver des creneaux qui se chevauchent.
 * Elle repose sur un verrou avisoire par organisation et sur une
 * re-verification faite DANS la transaction — deux choses qu'un test statique
 * peut constater mais pas eprouver.
 *
 * Ce chemin n'avait aucune couverture comportementale, et il vient d'etre
 * restructure: la verification complete (fermetures, horaires, agenda Google)
 * a ete sortie de la transaction pour ne pas tenir le verrou pendant un appel
 * reseau, ne laissant sous le verrou que la re-verification du chevauchement.
 * Un tel decoupage se justifie par un raisonnement, mais c'est le
 * comportement qu'il faut verifier: d'ou cette suite.
 *
 * Test A BASE DE DONNEES: seed d'une org isolee (ids uniques par run via
 * `stamp`), nettoyage best-effort en fin de suite. L'offre est semee sans
 * `createdBy` ni coordonnees client, ce qui neutralise les effets de bord
 * (miroir Google Agenda, e-mail/SMS de confirmation) sans rien changer a la
 * logique de reservation.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  organisationsTable,
  appointmentOffersTable,
  calendarEventsTable,
} from "@workspace/db";
import { confirmOfferSelection, rescheduleOffer } from "../services/appointment-offers";

const stamp = Date.now();
const HOUR_MS = 60 * 60 * 1000;

/** Demain, a heure fixe UTC: toujours dans le futur, jamais un jour ferme. */
function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date(Date.now() + 24 * HOUR_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/**
 * Creneaux d'une demi-heure, un par test.
 *
 * Toute la suite partage une seule organisation, donc un seul agenda: deux
 * tests qui reserveraient la meme heure se gêneraient l'un l'autre, et le
 * second echouerait pour une raison qui n'a rien a voir avec ce qu'il verifie.
 * Chaque test a donc son heure a lui, et les chevauchements sont voulus la ou
 * ils sont testes.
 */
const slot = (hour: number, minute = 0) => ({
  start: tomorrowAt(hour, minute),
  end: tomorrowAt(hour, minute + 30),
});

let orgId: number;

async function seedOffer(
  suffix: string,
  slots: Array<{ start: Date; end: Date }>,
): Promise<string> {
  const token = `tok-${stamp}-${suffix}`;
  await db.insert(appointmentOffersTable).values({
    organisationId: orgId,
    reason: `RDV test ${suffix}`,
    durationMinutes: 30,
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    token,
    status: "envoye",
    // Ni createdBy ni coordonnees: aucun envoi ni appel Google declenche.
    createdBy: null,
    contactEmail: null,
    contactPhone: null,
  });
  return token;
}

async function offerRow(token: string) {
  const [row] = await db
    .select()
    .from(appointmentOffersTable)
    .where(eq(appointmentOffersTable.token, token))
    .limit(1);
  return row;
}

async function eventCount(): Promise<number> {
  const rows = await db
    .select({ id: calendarEventsTable.id })
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.organisationId, orgId));
  return rows.length;
}

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Booking DB ${stamp}`,
      slug: `booking-db-${stamp}`,
      maxUsers: 10,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;
});

afterAll(async () => {
  try {
    await db.delete(appointmentOffersTable).where(eq(appointmentOffersTable.organisationId, orgId));
    await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch {
    // best-effort: ids uniques par run (stamp).
  }
});

describe("confirmation d'un creneau", () => {
  it("reserve le creneau et ecrit l'evenement d'agenda", async () => {
    const choisi = slot(6);
    const token = await seedOffer("confirm", [choisi, slot(7)]);

    const res = await confirmOfferSelection(token, 0);
    expect(res.ok, `confirmation refusee: ${res.ok ? "" : res.message}`).toBe(true);

    const row = await offerRow(token);
    expect(row.status).toBe("confirme");
    expect(row.selectedSlotIndex).toBe(0);
    expect(row.selectedStart?.getTime()).toBe(choisi.start.getTime());
    expect(row.calendarEventId).not.toBeNull();
    expect(await eventCount()).toBe(1);
  });

  it("refuse une seconde confirmation de la MEME offre", async () => {
    const token = await seedOffer("double", [slot(8)]);

    const first = await confirmOfferSelection(token, 0);
    expect(first.ok).toBe(true);

    const second = await confirmOfferSelection(token, 0);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("already");
  });

  it("refuse un creneau invalide sans rien reserver", async () => {
    const token = await seedOffer("invalide", [slot(9)]);
    const res = await confirmOfferSelection(token, 7);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_slot");
    expect((await offerRow(token)).status).toBe("envoye");
  });
});

describe("deux offres distinctes sur des creneaux qui se chevauchent", () => {
  it("n'en laisse reserver qu'une seule", async () => {
    // La garantie centrale: la clause `status='envoye'` ne protege que contre
    // la double confirmation d'une meme offre. Ici les offres sont
    // DIFFERENTES — seule la re-verification sous verrou les departage.
    const premier = await seedOffer("chevauche-1", [slot(11)]);
    // Decale de 15 minutes: chevauche le precedent sans lui etre identique.
    const second = await seedOffer("chevauche-2", [slot(11, 15)]);

    const avant = await eventCount();

    const a = await confirmOfferSelection(premier, 0);
    expect(a.ok).toBe(true);

    const b = await confirmOfferSelection(second, 0);
    expect(b.ok, "le creneau chevauchant a ete accepte").toBe(false);
    if (!b.ok) expect(b.code).toBe("conflict");

    // L'offre refusee reste proposable, et aucun second evenement n'est ne.
    expect((await offerRow(second)).status).toBe("envoye");
    expect(await eventCount()).toBe(avant + 1);
  });

  it("n'en laisse passer qu'une seule quand les deux arrivent EN MEME TEMPS", async () => {
    // Le test precedent enchaine les deux confirmations: la seconde voit un
    // agenda deja ecrit, et passerait meme sans verrou. C'est ce cas-ci qui
    // eprouve la garantie — les deux transactions se disputent le creneau au
    // meme instant, et seule la serialisation par le verrou avisoire, suivie
    // de la re-verification DANS la transaction, peut les departager.
    //
    // Sans verrou, les deux verifieraient la disponibilite avant que l'autre
    // n'ait ecrit, et deux clients repartiraient avec le meme creneau.
    const a = await seedOffer("simultane-1", [slot(20)]);
    const b = await seedOffer("simultane-2", [slot(20, 15)]);
    const avant = await eventCount();

    const [ra, rb] = await Promise.all([
      confirmOfferSelection(a, 0),
      confirmOfferSelection(b, 0),
    ]);

    const acceptees = [ra, rb].filter((r) => r.ok);
    const refusees = [ra, rb].filter((r) => !r.ok);
    expect(acceptees, "les deux offres ont ete acceptees").toHaveLength(1);
    expect(refusees).toHaveLength(1);
    for (const r of refusees) if (!r.ok) expect(r.code).toBe("conflict");

    // La preuve qui compte vraiment: un seul rendez-vous dans l'agenda.
    expect(await eventCount()).toBe(avant + 1);
  });

  it("accepte un creneau libre apres un refus", async () => {
    // Le refus ne doit pas condamner l'offre: le client choisit un autre
    // creneau et la reservation aboutit.
    // Index 0 chevauche le rendez-vous pris au test precedent (11h00), index 1
    // est libre.
    const token = await seedOffer("repli", [slot(11, 15), slot(13)]);

    const refuse = await confirmOfferSelection(token, 0);
    expect(refuse.ok).toBe(false);

    const accepte = await confirmOfferSelection(token, 1);
    expect(accepte.ok, `repli refuse: ${accepte.ok ? "" : accepte.message}`).toBe(true);
    expect((await offerRow(token)).status).toBe("confirme");
  });
});

describe("reprogrammation", () => {
  it("deplace le rendez-vous sans creer de second evenement", async () => {
    const cible = slot(16);
    const token = await seedOffer("repro", [slot(15), cible]);

    const confirme = await confirmOfferSelection(token, 0);
    expect(confirme.ok, `confirmation refusee: ${confirme.ok ? "" : confirme.message}`).toBe(true);
    const apresConfirmation = await eventCount();

    const res = await rescheduleOffer(token, 1);
    expect(res.ok, `reprogrammation refusee: ${res.ok ? "" : res.message}`).toBe(true);

    const row = await offerRow(token);
    expect(row.selectedSlotIndex).toBe(1);
    expect(row.selectedStart?.getTime()).toBe(cible.start.getTime());
    // Le rendez-vous est deplace, pas duplique.
    expect(await eventCount()).toBe(apresConfirmation);
  });

  it("ne se bloque pas sur son propre evenement", async () => {
    // L'evenement deja pose par cette offre doit etre exclu de la
    // re-verification, sinon toute reprogrammation vers un creneau qui
    // recouvre l'ancien se refuserait elle-meme.
    const token = await seedOffer("auto-exclusion", [slot(18), slot(18, 15)]);

    expect((await confirmOfferSelection(token, 0)).ok).toBe(true);
    const res = await rescheduleOffer(token, 1);
    expect(res.ok, `l'offre s'est bloquee elle-meme: ${res.ok ? "" : res.message}`).toBe(true);
  });
});
