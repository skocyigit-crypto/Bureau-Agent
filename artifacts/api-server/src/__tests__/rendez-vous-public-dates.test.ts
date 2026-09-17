/**
 * Lien public de rendez-vous : bornes dans le temps (base reelle, vrai routeur).
 *
 * Mesure le 17/09 : reserver un creneau deja passe, annuler ou reprogrammer un
 * rendez-vous deja tenu, reprogrammer en 2090 — tout etait accepte.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { appointmentOffersTable, calendarEventsTable, db, organisationsTable } from "@workspace/db";
import router from "../routes/public-appointments";
import { creneauEncoreReservable, dansLHorizon, rendezVousDejaPasse } from "../services/garde-rendez-vous";

const stamp = Date.now();
const H = 3600_000;
let orgId = 0;
let n = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } }; next(); });
  a.use("/api", router);
  return a;
}
const plage = (debut: Date) => ({ start: debut.toISOString(), end: new Date(debut.getTime() + 30 * 60_000).toISOString() });

async function offre(v: { slots: Date[]; status?: string; selectedStart?: Date }) {
  const token = `rdvdates-${stamp}-${++n}`;
  await db.insert(appointmentOffersTable).values({
    organisationId: orgId, reason: "Test", durationMinutes: 30, token,
    slots: v.slots.map(plage), status: v.status ?? "envoye",
    selectedSlotIndex: v.selectedStart ? 0 : null,
    selectedStart: v.selectedStart ?? null,
    selectedEnd: v.selectedStart ? new Date(v.selectedStart.getTime() + 30 * 60_000) : null,
    createdBy: null, contactEmail: null, contactPhone: null,
    expiresAt: new Date(Date.now() + 7 * 24 * H),
  } as any);
  return token;
}
const lire = async (token: string) => (await db.select().from(appointmentOffersTable).where(eq(appointmentOffersTable.token, token)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `RdvDates ${stamp}`, slug: `rdvdates-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);
afterAll(async () => {
  await db.delete(appointmentOffersTable).where(eq(appointmentOffersTable.organisationId, orgId));
  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
  await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

describe("regles pures", () => {
  const now = new Date("2026-09-17T10:00:00Z");
  it("delai minimum d'une heure", () => {
    expect([creneauEncoreReservable(new Date("2026-09-17T10:59:00Z"), now), creneauEncoreReservable(new Date("2026-09-17T11:00:00Z"), now)]).toEqual([false, true]);
  });
  it("horizon de 60 jours", () => {
    expect([dansLHorizon(new Date("2026-11-16T10:00:00Z"), now), dansLHorizon(new Date("2026-11-17T10:00:01Z"), now)]).toEqual([true, false]);
  });
  it("rendez-vous passe", () => {
    expect([rendezVousDejaPasse(null, now), rendezVousDejaPasse(new Date("2026-09-17T09:00:00Z"), now), rendezVousDejaPasse(new Date("2026-09-18T09:00:00Z"), now)]).toEqual([false, true, false]);
  });
});

describe("lien public", () => {
  it("un creneau deja passe ne se reserve pas", async () => {
    const token = await offre({ slots: [new Date(Date.now() - 2 * H)] });
    const r = await request(appli()).post(`/api/appointments/offer/${token}/select`).send({ slotIndex: 0 });
    expect(r.status).toBe(400);
    expect((await lire(token)).status).toBe("envoye");
  });

  it("un creneau dans 30 minutes non plus (delai d'une heure)", async () => {
    const token = await offre({ slots: [new Date(Date.now() + 30 * 60_000)] });
    expect((await request(appli()).post(`/api/appointments/offer/${token}/select`).send({ slotIndex: 0 })).status).toBe(400);
  });

  it("un rendez-vous deja tenu ne s'annule plus en ligne", async () => {
    const token = await offre({ slots: [new Date(Date.now() - 26 * H)], status: "confirme", selectedStart: new Date(Date.now() - 26 * H) });
    const r = await request(appli()).post(`/api/appointments/offer/${token}/cancel`);
    expect(r.status).toBe(409);
    expect((await lire(token)).status).toBe("confirme");
  });

  it("un rendez-vous a venir s'annule toujours", async () => {
    const debut = new Date(Date.now() + 48 * H);
    const token = await offre({ slots: [debut], status: "confirme", selectedStart: debut });
    expect((await request(appli()).post(`/api/appointments/offer/${token}/cancel`)).status).toBe(200);
    expect((await lire(token)).status).toBe("annule");
  });

  it("un rendez-vous deja tenu ne se reprogramme plus", async () => {
    const passe = new Date(Date.now() - 26 * H);
    const token = await offre({ slots: [passe], status: "confirme", selectedStart: passe });
    const r = await request(appli()).post(`/api/appointments/offer/${token}/reschedule`).send({ slot: plage(new Date(Date.now() + 72 * H)) });
    expect(r.status).toBe(410);
    expect((await lire(token)).selectedStart!.getTime()).toBe(passe.getTime());
  });

  it("reprogrammer sur un creneau d'origine deja passe est refuse", async () => {
    const futur = new Date(Date.now() + 48 * H);
    const token = await offre({ slots: [new Date(Date.now() - 3 * H), futur], status: "confirme", selectedStart: futur });
    expect((await request(appli()).post(`/api/appointments/offer/${token}/reschedule`).send({ slotIndex: 0 })).status).toBe(400);
  });

  it("reprogrammer en 2090 est refuse", async () => {
    const futur = new Date(Date.now() + 48 * H);
    const token = await offre({ slots: [futur], status: "confirme", selectedStart: futur });
    const r = await request(appli()).post(`/api/appointments/offer/${token}/reschedule`).send({ slot: plage(new Date("2090-03-05T09:00:00Z")) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/eloigne/);
  });
});
