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
import { persistOutcome, traiterConfirmation } from "../routes/voice-receptionist";
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
    callSid: `CA-rdv-${Math.random().toString(36).slice(2)}`, fuseau: "Europe/Paris",
    rdvPropose: null, rdvCree: null, transfert: null, rappelMessageId: null, demande: "", journal: [], echecsModele: 0,
  } as any;
}
/** Le modele rend date et heure MURALES ; le code en fait un instant. */
function resultat(date: string | null, time: string | null) {
  return {
    say: "", done: true, outcome: "appointment",
    appointment: { name: "Jean Dupont", reason: "Devis", date, time, timezone: null },
    message: null, summary: "", sentiment: "neutre", urgent: false, transfer: false, confirmation: null,
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

describe("demande de rendez-vous : ce qui est ecrit", () => {
  // Contrat depuis le 28/09 : persistOutcome n'ECRIT plus de rendez-vous. Il
  // propose un creneau verifie ; seul le « oui » de l'appelant
  // (traiterConfirmation) l'inscrit. Un horaire hors delai ne cree ni
  // rendez-vous ni message : l'appelant est interroge a nouveau.
  const jourOuvre = (jours: number) => {
    let d = new Date(Date.now() + jours * 86400_000);
    const dow = (x: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Paris" }).format(x);
    while (["Sat", "Sun"].includes(dow(d))) d = new Date(d.getTime() + 86400_000);
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris" }).format(d);
  };
  const dateParis = (x: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris" }).format(x);

  it("un horaire dans le passe ne cree aucun evenement et redemande un moment", async () => {
    const hier = dateParis(new Date(Date.now() - 48 * H));
    const suite = await persistOutcome(session(), resultat(hier, "10:00"));
    expect(suite?.say).toMatch(/au moins une heure à l'avance/);
    expect(await evenements()).toEqual([]);
  });

  it("… et ne fabrique pas de message a la place", async () => {
    expect(await messages()).toEqual([]);
  });

  it("un horaire en 2090 ne cree aucun evenement", async () => {
    await persistOutcome(session(), resultat("2090-03-05", "09:00"));
    expect(await evenements()).toEqual([]);
  });

  it("un horaire valide est PROPOSE, pas ecrit", async () => {
    const s = session();
    const suite = await persistOutcome(s, resultat(jourOuvre(3), "10:00"));
    expect(suite?.say).toMatch(/Confirmez-vous ce rendez-vous/);
    expect(s.rdvPropose).not.toBeNull();
    expect(await evenements()).toEqual([]);
  });

  it("le « oui » cree le rendez-vous au bon instant, avec le numero de l'appelant", async () => {
    const s = session();
    const jour = jourOuvre(4);
    await persistOutcome(s, resultat(jour, "10:00"));
    await traiterConfirmation(s, "oui");
    const evts = await evenements();
    expect(evts.length).toBe(1);
    expect(evts[0]!.status).toBe("confirme");
    expect(dateParis(new Date(evts[0]!.startDate))).toBe(jour);
    expect(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(evts[0]!.startDate))).toBe("10:00");
    expect(evts[0]!.contactPhone).toBe("+33612345678");
  });

  it("une confirmation repetee pour le meme appel n'ecrit pas deux fois", async () => {
    const s = session();
    s.callSid = "CA-meme-appel";
    await persistOutcome(s, resultat(jourOuvre(5), "11:00"));
    const propose = s.rdvPropose;
    await traiterConfirmation(s, "oui");
    s.rdvPropose = propose;
    await traiterConfirmation(s, "oui");
    expect((await evenements()).filter((e) => e.externalRef === "voice:CA-meme-appel").length).toBe(1);
  });
});
