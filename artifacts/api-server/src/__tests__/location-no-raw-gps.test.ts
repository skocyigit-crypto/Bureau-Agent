/**
 * Ce que l'employeur recoit reellement du suivi de presence.
 *
 * La notice affichee au salarie avant d'activer le suivi (mobile,
 * `locationConsentGate`) affirme, sous le titre « Ce qui est visible par votre
 * employeur »:
 *
 *   « Uniquement la zone (geofence) ou vous vous trouvez et l'heure du dernier
 *     passage. La position GPS exacte n'est PAS affichee. »
 *
 * C'etait vrai de l'ECRAN, pas des donnees: `/admin/team-locations` renvoyait
 * `lastLat`, `lastLng` et `lastAccuracyM`, et l'historique faisait un
 * `select()` sans projection — donc la latitude et la longitude de chaque
 * entree/sortie, sur 30 jours. L'interface n'en affichait rien, mais tout
 * transitait vers le navigateur du dirigeant: lisible dans l'onglet reseau, et
 * recuperable par un simple appel a l'API avec sa session.
 *
 * Une promesse de confidentialite doit tenir au niveau de la donnee, pas au
 * niveau du pixel. Tenue par convention, elle devenait fausse en silence a la
 * premiere evolution de l'interface.
 *
 * Le suivi lui-meme n'est pas en cause ici — il reste ce que l'exploitant a
 * demande. Ce test verrouille seulement l'ecart entre ce qui est promis au
 * salarie et ce qui sort du serveur.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  geofencesTable,
  locationEventsTable,
  organisationsTable,
  userLocationStateTable,
  usersTable,
} from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const stamp = Date.now();
// Des coordonnees reconnaissables: si elles ressortent, on les voit.
const LAT = 48.858093;
const LNG = 2.294694;

let orgId = 0;
let adminToken = "";
let employeId = 0;

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({ name: `Loc GPS ${stamp}`, slug: `loc-gps-${stamp}`, maxUsers: 10, actif: true })
    .returning({ id: organisationsTable.id });
  orgId = org.id;

  const [admin] = await db.insert(usersTable).values({
    email: `loc-admin-${stamp}@example.test`,
    passwordHash: "x", nom: "Chef", prenom: "Test",
    role: "administrateur", organisationId: orgId, actif: true,
  }).returning({ id: usersTable.id });
  adminToken = mintApiToken({
    userId: admin.id, userRole: "administrateur", organisationId: orgId,
    userEmail: `loc-admin-${stamp}@example.test`, prenom: "Test", nom: "Chef",
  });

  const [employe] = await db.insert(usersTable).values({
    email: `loc-employe-${stamp}@example.test`,
    passwordHash: "x", nom: "Salarie", prenom: "Test",
    role: "agent", organisationId: orgId, actif: true,
  }).returning({ id: usersTable.id });
  employeId = employe.id;

  const [zone] = await db.insert(geofencesTable).values({
    organisationId: orgId, name: `Chantier ${stamp}`,
    lat: LAT, lng: LNG, radiusM: 150, isActive: true,
  }).returning({ id: geofencesTable.id });

  await db.insert(userLocationStateTable).values({
    organisationId: orgId, userId: employeId,
    lastLat: LAT, lastLng: LNG, lastAccuracyM: 12, lastAt: new Date(),
    currentGeofenceIds: [zone.id],
  });

  await db.insert(locationEventsTable).values({
    organisationId: orgId, userId: employeId, geofenceId: zone.id,
    event: "enter", lat: LAT, lng: LNG, at: new Date(),
  });
});

afterAll(async () => {
  try {
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch {
    // Menage « au mieux »: les identifiants portent l'horodatage du run.
  }
});

/** Cherche une coordonnee n'importe ou dans la reponse, quelle qu'en soit la forme. */
function contientCoordonnee(charge: unknown): boolean {
  const texte = JSON.stringify(charge ?? null);
  // La troncature du serialiseur n'est pas un risque: on cherche le prefixe
  // significatif, pas l'egalite exacte au dernier chiffre.
  return texte.includes("48.858") || texte.includes("2.2946");
}

describe("le suivi de presence ne livre pas la position exacte a l'employeur", () => {
  it("l'etat de l'equipe donne la zone, pas les coordonnees", async () => {
    const res = await request(app)
      .get("/api/admin/team-locations")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const etat = res.body.states?.find((s: { userId: number }) => s.userId === employeId);
    expect(etat, "l'employe suivi devrait figurer dans l'etat de l'equipe").toBeTruthy();

    // Ce qui doit rester: la zone et l'heure — c'est l'objet du suivi.
    expect(etat.currentGeofenceIds?.length ?? 0).toBeGreaterThan(0);
    expect(etat.lastAt).toBeTruthy();

    // Ce qui ne doit pas sortir.
    expect(etat.lastLat, "latitude exacte transmise au dirigeant").toBeUndefined();
    expect(etat.lastLng, "longitude exacte transmise au dirigeant").toBeUndefined();
    expect(contientCoordonnee(res.body), "coordonnees presentes ailleurs dans la reponse").toBe(false);
  });

  it("l'historique donne les entrees/sorties, pas la trace GPS", async () => {
    const res = await request(app)
      .get(`/api/admin/team-locations/history?userId=${employeId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const evenements = res.body.events ?? [];
    expect(evenements.length, "l'evenement seme devrait etre retourne").toBeGreaterThan(0);

    // Ce qui doit rester: de quoi lire « entree — Chantier — a telle heure ».
    expect(evenements[0].event).toBe("enter");
    expect(evenements[0].geofenceId).toBeTruthy();
    expect(evenements[0].at).toBeTruthy();

    // Ce qui ne doit pas sortir: 30 jours de trace au metre pres.
    expect(evenements[0].lat, "trace GPS exacte transmise au dirigeant").toBeUndefined();
    expect(evenements[0].lng, "trace GPS exacte transmise au dirigeant").toBeUndefined();
    expect(contientCoordonnee(res.body), "coordonnees presentes ailleurs dans la reponse").toBe(false);
  });

  it("les zones, elles, gardent leurs coordonnees", async () => {
    // Garde-fou du correctif: une geofence EST un point sur une carte, definie
    // par l'employeur. La retirer casserait l'ecran d'administration — ce n'est
    // pas une donnee de localisation d'une personne.
    const res = await request(app)
      .get("/api/geofences")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const zone = res.body.geofences?.[0];
    expect(zone?.lat).toBeTypeOf("number");
    expect(zone?.lng).toBeTypeOf("number");
  });
});
