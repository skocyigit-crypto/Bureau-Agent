/**
 * La secretaire telephonique IA n'inscrit pas un rendez-vous dans le passe.
 *
 * Mesure le 18/09 : avant d'ecrire, la route ne verifiait que le chevauchement
 * et les fermetures (`isSlotFree`). Quand le modele lisait mal l'intention de
 * l'appelant (« mardi » de la semaine passee, annee erronee), l'evenement
 * s'inscrivait dans le passe ou en 2090 : invisible dans l'agenda du client,
 * alors que l'appelant raccrochait en croyant avoir un creneau.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../services/availability", async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  // L'agenda est toujours libre : on isole la garde temporelle.
  return { ...reel, isSlotFree: async () => true };
});

import { eq } from "drizzle-orm";
import { calendarEventsTable, db, messagesTable, organisationsTable } from "@workspace/db";
import { persistOutcome } from "../routes/voice-receptionist";
import { horaireInscriptibleParIa } from "../services/garde-rendez-vous";

const stamp = Date.now();
const H = 3600_000;
let orgId = 0;

function session() {
  return {
    orgId, providerId: null, callerNumber: "+33612345678", toNumber: "+33123456789",
    lang: "fr", voice: "alice", orgName: "Test", turns: [], fulfilled: false, persisting: false,
    startedAt: Date.now(), emptyCount: 0, callerName: null, callCount: 0, busyBlock: "", freeBlock: "",
    callerContactId: null, cfg: { smsConfirmation: false, autoFollowupTask: false },
  } as any;
}
function resultat(startIso: string | null) {
  return {
    say: "", done: true, outcome: "appointment",
    appointment: { name: "Jean Dupont", reason: "Devis", whenText: "mardi 9h", startIso },
    message: null, summary: "", sentiment: "neutre", urgent: false, wantsHuman: false,
  } as any;
}
const evenements = async () => db.select().from(calendarEventsTable).where(eq(calendarEventsTable.organisationId, orgId));
const messages = async () => db.select().from(messagesTable).where(eq(messagesTable.organisationId, orgId));

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Voix ${stamp}`, slug: `voix-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);
afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* best-effort */ }
});

describe("regle pure", () => {
  const maintenant = new Date("2026-09-18T10:00:00Z");
  it("hier : refuse", () => {
    expect(horaireInscriptibleParIa(new Date("2026-09-17T14:00:00Z"), maintenant)).toBe(false);
  });
  it("dans 30 minutes : refuse (delai d'une heure)", () => {
    expect(horaireInscriptibleParIa(new Date("2026-09-18T10:30:00Z"), maintenant)).toBe(false);
  });
  it("demain : accepte", () => {
    expect(horaireInscriptibleParIa(new Date("2026-09-19T09:00:00Z"), maintenant)).toBe(true);
  });
  it("en 2090 : refuse", () => {
    expect(horaireInscriptibleParIa(new Date("2090-03-05T09:00:00Z"), maintenant)).toBe(false);
  });
  it("date illisible : refuse", () => {
    expect(horaireInscriptibleParIa(new Date("pas une date"), maintenant)).toBe(false);
  });
});

describe("fin d'appel : ce qui est ecrit", () => {
  it("un horaire dans le passe ne cree aucun evenement", async () => {
    await persistOutcome(session(), resultat(new Date(Date.now() - 48 * H).toISOString()));
    expect(await evenements()).toEqual([]);
  });

  it("… et laisse une trace exploitable pour rappeler l'appelant", async () => {
    expect((await messages()).length).toBeGreaterThan(0);
  });

  it("un horaire en 2090 ne cree aucun evenement", async () => {
    await persistOutcome(session(), resultat("2090-03-05T09:00:00.000Z"));
    expect(await evenements()).toEqual([]);
  });

  it("un horaire valide cree bien le rendez-vous", async () => {
    const debut = new Date(Date.now() + 48 * H);
    await persistOutcome(session(), resultat(debut.toISOString()));
    const evts = await evenements();
    expect(evts.length).toBe(1);
    expect(evts[0]!.status).toBe("a_confirmer");
    expect(new Date(evts[0]!.startDate).getTime()).toBe(debut.getTime());
  });

  it("le rendez-vous cree porte le numero de l'appelant", async () => {
    const evts = await evenements();
    expect(evts[0]!.contactPhone).toBe("+33612345678");
  });

  it("une session deja traitee n'ecrit pas deux fois", async () => {
    const s = session();
    s.fulfilled = true;
    await persistOutcome(s, resultat(new Date(Date.now() + 72 * H).toISOString()));
    expect((await evenements()).length).toBe(1);
  });
});
