/**
 * La zone est calculee, la position n'est pas conservee.
 * Base reelle + vrai routeur : un « on ne stocke plus » se prouve en relisant la base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, geofencesTable, locationEventsTable, organisationsTable, userLocationStateTable, usersTable } from "@workspace/db";
import locationsRouter from "../routes/locations";
import { effacerCoordonnees } from "../services/location-cleanup-cron";

const stamp = Date.now();
let orgId = 0;
let userId = 0;
let zoneId = 0;
const CHANTIER = { lat: 48.8155, lng: 7.7905 };

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "agent" };
    next();
  });
  a.use("/api", locationsRouter);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Geoloc ${stamp}`, slug: `geoloc-${stamp}`, email: `geoloc-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true,
    // Fenetre ouverte toute la semaine, toute la journee : le test ne depend pas de l'heure.
    locationTrackingDays: "1,2,3,4,5,6,7", locationTrackingStart: "00:00", locationTrackingEnd: "23:59",
  } as any).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `geo-${stamp}@example.test`, passwordHash: "x", prenom: "G", nom: "Eo", role: "agent", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
  const [z] = await db.insert(geofencesTable).values({ organisationId: orgId, name: "Chantier", lat: CHANTIER.lat, lng: CHANTIER.lng, radiusM: 200 } as any).returning({ id: geofencesTable.id });
  zoneId = z!.id;
}, 60_000);

afterAll(async () => { if (orgId) await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); });

describe("releve de position (route reelle)", () => {
  it("l'entree en zone est bien detectee", async () => {
    const r = await request(app()).post("/api/location/ping").send({ lat: CHANTIER.lat + 0.0003, lng: CHANTIER.lng, accuracyM: 12 });
    expect(r.status).toBeLessThan(300);
    const evts = await db.select().from(locationEventsTable).where(eq(locationEventsTable.userId, userId));
    expect(evts.some((e) => e.event === "enter" && e.geofenceId === zoneId)).toBe(true);
  }, 60_000);
  it("…mais aucune coordonnee n'est conservee dans le journal", async () => {
    const evts = await db.select().from(locationEventsTable).where(eq(locationEventsTable.userId, userId));
    expect(evts.length).toBeGreaterThan(0);
    for (const e of evts) expect([e.lat, e.lng, e.accuracyM]).toEqual([null, null, null]);
  });
  it("…ni dans l'etat courant, qui garde la zone et l'heure", async () => {
    const [etat] = await db.select().from(userLocationStateTable).where(eq(userLocationStateTable.userId, userId));
    expect([etat!.lastLat, etat!.lastLng, etat!.lastAccuracyM]).toEqual([null, null, null]);
    expect(etat!.currentGeofenceIds).toContain(zoneId);
    expect(etat!.lastAt).toBeTruthy();
  });
  it("la sortie de zone est detectee sans coordonnee conservee", async () => {
    await request(app()).post("/api/location/ping").send({ lat: CHANTIER.lat + 0.05, lng: CHANTIER.lng });
    const evts = await db.select().from(locationEventsTable).where(eq(locationEventsTable.userId, userId));
    expect(evts.some((e) => e.event === "exit" && e.geofenceId === zoneId && e.lat === null)).toBe(true);
  }, 60_000);
});

describe("coordonnees anterieures", () => {
  it("le passage de nettoyage efface celles d'avant la correction", async () => {
    // Ligne ecrite comme l'ancien code le faisait.
    await db.insert(locationEventsTable).values({ organisationId: orgId, userId, event: "ping", lat: 48.1, lng: 7.1, accuracyM: 5 } as any);
    const r = await effacerCoordonnees();
    expect(r.evenements).toBeGreaterThanOrEqual(1);
    const restes = (await db.select().from(locationEventsTable).where(eq(locationEventsTable.userId, userId))).filter((e) => e.lat !== null || e.lng !== null);
    expect(restes).toEqual([]);
  }, 60_000);
  it("idempotent : un second passage ne touche rien de cette organisation", async () => {
    await effacerCoordonnees();
    const restes = (await db.select().from(locationEventsTable).where(eq(locationEventsTable.userId, userId))).filter((e) => e.lat !== null);
    expect(restes).toEqual([]);
  }, 60_000);
});

describe("notice et schema", () => {
  const fr = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "mobile", "lib", "i18n", "locales", "fr.json"), "utf8")).locationConsentGate;
  it("la notice dit que les coordonnees ne sont pas conservees", () => expect(fr.bulletCollected1).toContain("ne sont pas conservées"));
  it("la notice ne dit plus « en permanence »", () => expect(fr.permIntro).not.toContain("en permanence"));
  it("les six langues ont ete mises a jour", () => {
    for (const l of ["ar", "de", "en", "es", "fr", "tr"]) {
      const g = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "mobile", "lib", "i18n", "locales", `${l}.json`), "utf8")).locationConsentGate;
      expect(g.bulletCollected1, l).not.toBe("- Latitude / longitude transmises au serveur de votre employeur.");
    }
  });
});

describe("inventaire RGPD", () => {
  const dp = readFileSync(join(import.meta.dirname, "..", "routes", "data-protection.ts"), "utf8");
  it("la geolocalisation est declaree", () => expect(dp).toContain('category: "Géolocalisation (présence sur zone)"'));
  it("sa duree est celle de la purge, pas un nombre recopie", () => expect(dp).toContain("retention: `${GEOLOC_RETENTION_DAYS} jours`"));
});
