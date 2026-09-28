/**
 * Secretaire telephonique IA — les appels, de bout en bout, sur les VRAIES
 * routes Twilio et la VRAIE base.
 *
 * Chaque requete est signee comme Twilio la signe (HMAC-SHA1 de l'URL et des
 * parametres tries, avec le jeton de l'organisation) : la verification de
 * signature, la resolution du locataire, l'etat en base, les ecritures et le
 * journal d'audit sont ceux de la production. Seuls sont simules : le modele
 * (reponses JSON scriptees), l'envoi de SMS et d'e-mails.
 *
 * Ce n'est PAS l'environnement de test de Twilio : aucun appel ne passe par
 * le reseau telephonique ici. C'est la meme requete HTTP que Twilio enverrait.
 *
 * Chaque scenario imprime une ligne « [preuve] » : identifiants des
 * enregistrements, evenements d'audit, phrases entendues par l'appelant.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db, organisationsTable, contactsTable, calendarEventsTable, messagesTable, callsTable,
  telephonyProvidersTable, auditLogsTable, voiceCallSessionsTable, tasksTable, telephonyCallLogsTable,
} from "@workspace/db";

const simu = vi.hoisted(() => ({
  reponses: [] as Array<string | Error>,
  appelsModele: 0,
  pannesAgenda: 0,
}));

vi.mock("../services/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-providers")>();
  return {
    ...actual,
    callOrgGemini: async () => {
      simu.appelsModele++;
      const r = simu.reponses.shift();
      if (r === undefined) throw new Error("[test] aucune reponse de modele en file");
      if (r instanceof Error) throw r;
      return { text: r };
    },
  };
});
vi.mock("../services/ai-quota", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-quota")>();
  return { ...actual, assertAiQuota: async () => {} };
});
vi.mock("../services/knowledge-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/knowledge-base")>();
  return { ...actual, searchKnowledge: async () => [] };
});
vi.mock("../services/telephony-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/telephony-providers")>();
  return { ...actual, sendSms: async () => ({ success: true, messageSid: "SMtest", status: "sent" }) };
});
vi.mock("../services/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/email")>();
  return { ...actual, sendEmail: async () => ({ success: true }) };
});
vi.mock("../services/availability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/availability")>();
  return {
    ...actual,
    // Panne d'agenda simulee a la demande (scenario « service en erreur »).
    isSlotFree: async (i: Parameters<typeof actual.isSlotFree>[0]) => {
      if (simu.pannesAgenda > 0) { simu.pannesAgenda--; throw new Error("[test] agenda indisponible"); }
      return actual.isSlotFree(i);
    },
  };
});

import { voiceReceptionistRouter, finaliserAppelsAbandonnes } from "../routes/voice-receptionist";
import { encryptProviderConfig } from "../services/telephony-providers";

const stamp = Date.now();
const APPELANT = "+33611111111";
const NUMERO_A = "+33100000001";
const NUMERO_B = "+33100000002";
const CONSEILLER = "+33700000009";
type Org = { id: number; accountSid: string; token: string; numero: string; contactId: number };
let A: Org, B: Org;
let n = 0;

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use("/api", voiceReceptionistRouter);

function signer(chemin: string, params: Record<string, string>, token: string): string {
  let s = `https://test.local${chemin}`;
  for (const k of Object.keys(params).sort()) s += k + params[k];
  return crypto.createHmac("sha1", token).update(s).digest("base64");
}
function twilio(chemin: string, params: Record<string, string>, token: string, cible: express.Express = app) {
  return request(cible).post(chemin)
    .set("x-forwarded-proto", "https").set("x-forwarded-host", "test.local")
    .set("x-twilio-signature", signer(chemin, params, token))
    .type("form").send(params);
}
const dit = (twiml: string) => [...twiml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => m[1]!.replace(/&apos;/g, "'")).join(" ");

async function appel(o: Org, from = APPELANT): Promise<string> {
  const callSid = `CA${stamp}x${++n}`;
  const r = await twilio("/api/voice/twilio/incoming", { AccountSid: o.accountSid, CallSid: callSid, From: from, To: o.numero }, o.token);
  expect(r.status, r.text).toBe(200);
  expect(dit(r.text)).toMatch(/intelligence artificielle/);
  return callSid;
}
async function parle(o: Org, callSid: string, texte: string, extra: Record<string, string> = {}): Promise<string> {
  const r = await twilio("/api/voice/twilio/respond", { AccountSid: o.accountSid, CallSid: callSid, From: APPELANT, To: o.numero, SpeechResult: texte, ...extra }, o.token);
  expect(r.status, r.text).toBe(200);
  return r.text;
}

const reponse = (o: Record<string, unknown>) => JSON.stringify({
  say: "Tres bien.", done: false, outcome: null, appointment: null, message: null, transfer: false,
  urgent: false, sentiment: "neutre", summary: "", lang: "fr", confirmation: null, ...o,
});
const rdv = (date: string | null, time: string | null, extra: Record<string, unknown> = {}) => reponse({
  say: "Je regarde l'agenda.", outcome: "appointment",
  appointment: { name: "Claire Martin", reason: "Devis cuisine", date, time, timezone: null, ...extra },
});

/** Prochain jour ouvre (lundi-vendredi) a Paris, au moins `jours` jours plus tard. */
function jourOuvre(jours: number): string {
  let d = new Date(Date.now() + jours * 86400_000);
  const dow = (x: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Europe/Paris" }).format(x);
  while (["Sat", "Sun"].includes(dow(d))) d = new Date(d.getTime() + 86400_000);
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris" }).format(d);
}
const heureParis = (d: Date) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(d);
const dateParis = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris" }).format(d);

const audit = async (callSid: string) => (await db.select({ action: auditLogsTable.action, org: auditLogsTable.organisationId })
  .from(auditLogsTable).where(eq(auditLogsTable.resourceId, callSid)).orderBy(asc(auditLogsTable.id))).map((a) => a.action);
const rdvDe = (o: Org, callSid: string) => db.select().from(calendarEventsTable)
  .where(and(eq(calendarEventsTable.organisationId, o.id), eq(calendarEventsTable.externalRef, `voice:${callSid}`)));
const rappelsDe = (o: Org) => db.select().from(messagesTable).where(and(eq(messagesTable.organisationId, o.id), eq(messagesTable.type, "rappel")));
const contact = async (id: number) => (await db.select().from(contactsTable).where(eq(contactsTable.id, id)))[0]!;
const etat = async (callSid: string) => (await db.select().from(voiceCallSessionsTable).where(eq(voiceCallSessionsTable.callSid, callSid)))[0]!;

function preuve(scenario: string, donnees: Record<string, unknown>) {
  console.log(`[preuve] ${JSON.stringify({ scenario, ...donnees })}`);
}

async function creerOrg(suffixe: string, numero: string, avecConseiller: boolean): Promise<Org> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Standard ${suffixe} ${stamp}`, slug: `standard-${suffixe}-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  const accountSid = `AC${suffixe}${stamp}`;
  const token = `tok_${suffixe}_${stamp}`;
  await db.insert(telephonyProvidersTable).values({
    organisationId: o!.id, provider: "twilio", label: `Standard ${suffixe}`, isActive: true,
    config: encryptProviderConfig("twilio", {
      accountSid, authToken: token, fromNumber: numero,
      aiReceptionist: {
        enabled: true, language: "fr", orgName: `Standard ${suffixe}`, smsConfirmation: true, autoFollowupTask: true,
        ...(avecConseiller ? { forwardToNumber: CONSEILLER } : {}),
      },
    }),
  });
  // Numero enregistre AVEC espaces : la reconnaissance de l'appelant doit
  // comparer les chiffres (le motif '\D' mal echappe ne le faisait pas).
  const [c] = await db.insert(contactsTable).values({
    organisationId: o!.id, firstName: "Claire", lastName: `Martin ${suffixe}`, phone: "+33 6 11 11 11 11",
  }).returning({ id: contactsTable.id });
  return { id: o!.id, accountSid, token, numero, contactId: c!.id };
}

beforeAll(async () => {
  A = await creerOrg("a", NUMERO_A, true);
  B = await creerOrg("b", NUMERO_B, false);
}, 60_000);

beforeEach(() => {
  simu.reponses.length = 0;
  simu.appelsModele = 0;
  simu.pannesAgenda = 0;
});

afterAll(async () => {
  for (const o of [A, B]) {
    if (!o) continue;
    try {
      await db.delete(voiceCallSessionsTable).where(eq(voiceCallSessionsTable.organisationId, o.id));
      await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, o.id));
      await db.delete(messagesTable).where(eq(messagesTable.organisationId, o.id));
      await db.delete(callsTable).where(eq(callsTable.organisationId, o.id));
      await db.delete(tasksTable).where(eq(tasksTable.organisationId, o.id));
      await db.delete(telephonyCallLogsTable).where(eq(telephonyCallLogsTable.organisationId, o.id));
      await db.delete(telephonyProvidersTable).where(eq(telephonyProvidersTable.organisationId, o.id));
    } catch { /* best-effort ; audit_logs est en ajout seul */ }
  }
});

describe("1. rendez-vous sur un creneau libre", () => {
  it("propose, lit date/heure/fuseau, n'ecrit qu'apres le « oui », puis relit l'enregistrement", async () => {
    const jour = jourOuvre(3);
    const sid = await appel(A);
    simu.reponses.push(rdv(jour, "14:30"));
    const proposition = dit(await parle(A, sid, "Je voudrais un rendez-vous a 14h30"));
    expect(proposition).toMatch(/Confirmez-vous ce rendez-vous/);
    expect(proposition).toMatch(/14:30, heure de Paris/);
    expect(await rdvDe(A, sid)).toHaveLength(0);

    const confirmation = dit(await parle(A, sid, "Oui, parfait"));
    expect(simu.appelsModele).toBe(1); // « oui » compris sans le modele
    const [ev] = await rdvDe(A, sid);
    expect(ev, "aucun rendez-vous apres le oui").toBeDefined();
    expect(ev!.status).toBe("confirme");
    expect(heureParis(ev!.startDate)).toBe("14:30");
    expect(dateParis(ev!.startDate)).toBe(jour);
    expect(ev!.relatedContactId).toBe(A.contactId);
    expect(confirmation).toMatch(/C'est enregistré/);
    expect(confirmation).toMatch(/14:30, heure de Paris \(/);
    const journal = await audit(sid);
    expect(journal).toEqual(expect.arrayContaining(["voice.call.started", "voice.appointment.proposed", "voice.appointment.created"]));
    preuve("rdv-creneau-libre", { callSid: sid, rendezVousId: ev!.id, debutUtc: ev!.startDate, heureParis: heureParis(ev!.startDate), contactId: ev!.relatedContactId, audit: journal, entendu: [proposition, confirmation] });
  });
});

describe("2. creneau occupe", () => {
  it("propose des creneaux libres et n'ecrit rien", async () => {
    const jour = jourOuvre(4);
    const [y, mo, d] = jour.split("-").map(Number);
    const debutOccupe = new Date(Date.UTC(y!, mo! - 1, d!, 8, 0)); // 10:00 ou 09:00 a Paris selon la saison
    await db.insert(calendarEventsTable).values({
      organisationId: A.id, title: "Occupe", startDate: debutOccupe, endDate: new Date(debutOccupe.getTime() + 3 * 3600_000),
    });
    const heure = heureParis(new Date(debutOccupe.getTime() + 3600_000));
    const sid = await appel(A);
    simu.reponses.push(rdv(jour, heure));
    const entendu = dit(await parle(A, sid, `Un rendez-vous a ${heure}`));
    expect(entendu).toMatch(/n'est pas disponible/);
    expect((entendu.match(/heure de Paris/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(await rdvDe(A, sid)).toHaveLength(0);
    expect((await etat(sid)).state).toMatchObject({ rdvPropose: null });
    preuve("creneau-occupe", { callSid: sid, occupe: `${jour} ${heure}`, audit: await audit(sid), entendu });
  });
});

describe("3. l'appelant refuse le creneau", () => {
  it("aucun rendez-vous n'est cree", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(5), "11:00"));
    await parle(A, sid, "Un rendez-vous a 11h");
    const entendu = dit(await parle(A, sid, "Non, ca ne me va pas"));
    expect(entendu).toMatch(/je n'enregistre rien/);
    expect(await rdvDe(A, sid)).toHaveLength(0);
    const journal = await audit(sid);
    expect(journal).toContain("voice.appointment.declined");
    expect(journal).not.toContain("voice.appointment.created");
    preuve("refus-appelant", { callSid: sid, rendezVous: 0, audit: journal, entendu });
  });
});

describe("4. date, heure ou fuseau ambigus", () => {
  it("jour manquant : la question du jour, rien d'ecrit", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(null, "14:30"));
    expect(dit(await parle(A, sid, "A 14h30"))).toMatch(/Pour quel jour/);
    expect(await rdvDe(A, sid)).toHaveLength(0);
  });

  it("heure manquante : la question de l'heure", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(3), null));
    expect(dit(await parle(A, sid, "Mardi en fin de journee"))).toMatch(/À quelle heure/);
  });

  it("autre fuseau cite : converti et lu dans les deux fuseaux", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(3), "09:00", { timezone: "America/New_York" }));
    const entendu = dit(await parle(A, sid, "A 9 heures, heure de New York"));
    expect(entendu).toMatch(/heure de Paris/);
    expect(entendu).toMatch(/soit 09:00 heure de New York/);
    preuve("fuseau-cite", { callSid: sid, entendu });
  });

  it("fuseau inconnu : la question du fuseau, rien d'ecrit", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(3), "10:00", { timezone: "Mars/Olympus_Mons" }));
    const entendu = dit(await parle(A, sid, "A 10 heures, heure de Mars"));
    expect(entendu).toMatch(/fuseau horaire/);
    expect(await rdvDe(A, sid)).toHaveLength(0);
    preuve("ambiguite", { callSid: sid, entendu, audit: await audit(sid) });
  });
});

describe("5. transfert vers un conseiller reussi", () => {
  it("<Dial> avec action, puis compte rendu sans rappel", async () => {
    const sid = await appel(A);
    simu.reponses.push(reponse({ say: "Je vous passe un conseiller.", transfer: true }));
    const twiml = await parle(A, sid, "Je veux parler a quelqu'un");
    expect(twiml).toMatch(new RegExp(`<Dial [^>]*action="/api/voice/twilio/transfert-resultat"[^>]*>\\${CONSEILLER}</Dial>`));
    expect((await etat(sid)).status).toBe("transfert");
    const avant = (await rappelsDe(A)).length;
    const fin = await twilio("/api/voice/twilio/transfert-resultat", { AccountSid: A.accountSid, CallSid: sid, DialCallStatus: "completed", DialCallDuration: "42" }, A.token);
    expect(fin.status).toBe(200);
    expect((await rappelsDe(A)).length).toBe(avant);
    const [c] = await db.select().from(callsTable).where(and(eq(callsTable.organisationId, A.id), eq(callsTable.phoneNumber, APPELANT))).orderBy(asc(callsTable.id));
    expect(c).toBeDefined();
    const journal = await audit(sid);
    expect(journal).toEqual(expect.arrayContaining(["voice.transfer.requested", "voice.transfer.succeeded", "voice.call.ended"]));
    preuve("transfert-reussi", { callSid: sid, audit: journal });
  });
});

describe("6. transfert sans reponse", () => {
  it("cree une demande de rappel rattachee au client, une seule meme si Twilio rejoue", async () => {
    const sid = await appel(A);
    simu.reponses.push(reponse({ say: "Je vous passe un conseiller.", transfer: true }));
    await parle(A, sid, "Un conseiller s'il vous plait");
    const params = { AccountSid: A.accountSid, CallSid: sid, DialCallStatus: "no-answer" };
    const r1 = await twilio("/api/voice/twilio/transfert-resultat", params, A.token);
    await twilio("/api/voice/twilio/transfert-resultat", params, A.token);
    expect(dit(r1.text)).toMatch(/Personne n'est disponible/);
    expect(dit(r1.text)).toMatch(/demande de rappel/);
    const etatFinal = await etat(sid);
    const rappelId = (etatFinal.actions as { rappel?: number }).rappel;
    const rappels = (await rappelsDe(A)).filter((m) => m.id === rappelId);
    expect(rappels).toHaveLength(1);
    expect(rappels[0]!.contactId).toBe(A.contactId);
    const journal = await audit(sid);
    expect(journal.filter((a) => a === "voice.callback.created")).toHaveLength(1);
    expect(journal).toContain("voice.transfer.failed");
    preuve("transfert-echoue-rappel", { callSid: sid, rappelMessageId: rappelId, contactId: rappels[0]!.contactId, audit: journal, entendu: dit(r1.text) });
  });

  it("sans numero de conseiller, la demande d'un humain devient un rappel", async () => {
    const sid = await appel(B);
    simu.reponses.push(reponse({ say: "Je note.", transfer: true }));
    const entendu = dit(await parle(B, sid, "Je veux un humain"));
    expect(entendu).toMatch(/demande de rappel/);
    expect((await audit(sid))).toContain("voice.callback.created");
  });
});

describe("7. note au dossier du bon client", () => {
  it("demande, resume et actions ajoutes au contact de l'appelant, et l'appel compte", async () => {
    const avant = await contact(A.contactId);
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(6), "15:00"));
    await parle(A, sid, "Un rendez-vous jeudi 15h pour un devis");
    await parle(A, sid, "Oui je confirme");
    simu.reponses.push(reponse({ say: "Au revoir.", done: true, summary: "Rendez-vous pris pour un devis de cuisine." }));
    await parle(A, sid, "Non merci, c'est tout");
    const apres = await contact(A.contactId);
    expect(apres.notes ?? "").toMatch(/Appel traité par la secrétaire IA/);
    expect(apres.notes ?? "").toMatch(/Résumé : Rendez-vous pris pour un devis de cuisine\./);
    expect(apres.notes ?? "").toMatch(/Rendez-vous #\d+ créé et confirmé/);
    expect(apres.totalCalls).toBe(avant.totalCalls + 1);
    const [c] = await db.select().from(callsTable).where(eq(callsTable.contactId, A.contactId)).orderBy(desc(callsTable.id));
    expect(c).toBeDefined();
    const journal = await audit(sid);
    expect(journal).toEqual(expect.arrayContaining(["voice.note.added", "voice.call.ended"]));
    preuve("note-dossier-client", { callSid: sid, contactId: A.contactId, callId: c!.id, note: (apres.notes ?? "").split("\n\n").at(-1), audit: journal });
  });
});

describe("8. isolation entre organisations", () => {
  it("la note va au contact de l'organisation appelee, jamais a celui d'une autre", async () => {
    const autre = await contact(B.contactId);
    const sid = await appel(A);
    simu.reponses.push(reponse({ say: "Au revoir.", done: true, summary: "Question sur les horaires." }));
    await parle(A, sid, "Quels sont vos horaires ? Merci, au revoir");
    expect((await contact(B.contactId)).notes).toBe(autre.notes);
    expect((await contact(B.contactId)).totalCalls).toBe(autre.totalCalls);
  });

  it("l'agenda d'une autre organisation ne bloque pas le creneau", async () => {
    const jour = jourOuvre(8);
    const [y, mo, d] = jour.split("-").map(Number);
    const debut = new Date(Date.UTC(y!, mo! - 1, d!, 11, 0));
    await db.insert(calendarEventsTable).values({ organisationId: B.id, title: "Occupe chez B", startDate: debut, endDate: new Date(debut.getTime() + 3600_000) });
    const sid = await appel(A);
    simu.reponses.push(rdv(jour, heureParis(debut)));
    expect(dit(await parle(A, sid, "Un rendez-vous"))).toMatch(/Confirmez-vous/);
  });

  it("une autre organisation ne pilote pas l'appel, meme signee avec son propre jeton", async () => {
    const sid = await appel(A);
    const r = await twilio("/api/voice/twilio/respond", { AccountSid: B.accountSid, CallSid: sid, SpeechResult: "Annulez tout" }, B.token);
    expect(r.status).toBe(403);
    const faux = await twilio("/api/voice/twilio/respond", { AccountSid: A.accountSid, CallSid: sid, SpeechResult: "x" }, B.token);
    expect(faux.status).toBe(403);
    expect(simu.appelsModele).toBe(0);
    preuve("isolation", { callSid: sid, autreOrg: r.status, mauvaiseSignature: faux.status });
  });
});

describe("9. pannes et nouvelles tentatives sans doublon", () => {
  it("Twilio rejoue la meme requete : meme reponse, le modele n'est pas rappele", async () => {
    const sid = await appel(A);
    simu.reponses.push(reponse({ say: "Bien sur, je vous ecoute." }));
    const params = { AccountSid: A.accountSid, CallSid: sid, From: APPELANT, To: A.numero, SpeechResult: "Bonjour" };
    const r1 = await twilio("/api/voice/twilio/respond", params, A.token);
    const r2 = await twilio("/api/voice/twilio/respond", params, A.token);
    expect(r2.text).toBe(r1.text);
    expect(simu.appelsModele).toBe(1);
    const tours = ((await etat(sid)).state as { turns: unknown[] }).turns;
    expect(tours).toHaveLength(3); // accueil, appelant, reponse — pas deux fois
  });

  it("agenda en panne a la confirmation : rien de perdu, un seul rendez-vous au second oui", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(9), "16:00"));
    await parle(A, sid, "Un rendez-vous a 16h");
    simu.pannesAgenda = 1;
    expect(dit(await parle(A, sid, "Oui"))).toMatch(/problème technique/);
    expect(await rdvDe(A, sid)).toHaveLength(0);
    await parle(A, sid, "Oui je confirme", { Confidence: "0.9" });
    expect(await rdvDe(A, sid)).toHaveLength(1);
    const journal = await audit(sid);
    expect(journal).toEqual(expect.arrayContaining(["voice.appointment.failed", "voice.appointment.created"]));
    preuve("panne-agenda-reprise", { callSid: sid, rendezVous: (await rdvDe(A, sid)).map((e) => e.id), audit: journal });
  });

  it("deux « oui » simultanes : un seul rendez-vous", async () => {
    const sid = await appel(A);
    simu.reponses.push(rdv(jourOuvre(10), "10:30"));
    await parle(A, sid, "Un rendez-vous a 10h30");
    await Promise.all([
      parle(A, sid, "Oui", { Confidence: "0.91" }),
      parle(A, sid, "Oui", { Confidence: "0.92" }),
    ]);
    expect(await rdvDe(A, sid)).toHaveLength(1);
  });

  it("le modele tombe : transfert s'il y a un conseiller, rappel reel sinon", async () => {
    const sidA = await appel(A);
    simu.reponses.push(new Error("[test] modele indisponible"));
    expect(await parle(A, sidA, "Bonjour")).toMatch(/<Dial /);
    const sidB = await appel(B);
    simu.reponses.push(new Error("[test] modele indisponible"));
    const entendu = dit(await parle(B, sidB, "Bonjour"));
    expect(entendu).toMatch(/demande de rappel/);
    const rappel = (await etat(sidB)).actions as { rappel?: number };
    expect(typeof rappel.rappel).toBe("number");
    preuve("panne-modele", { callSidAvecConseiller: sidA, callSidSansConseiller: sidB, rappelMessageId: rappel.rappel, audit: await audit(sidB) });
  });

  it("un appel abandonne (raccroche sans statut) est quand meme consigne", async () => {
    const sid = await appel(A);
    await db.update(voiceCallSessionsTable).set({ updatedAt: new Date(Date.now() - 45 * 60_000) }).where(eq(voiceCallSessionsTable.callSid, sid));
    await finaliserAppelsAbandonnes();
    expect((await etat(sid)).status).toBe("terminee");
    expect(await audit(sid)).toContain("voice.call.ended");
  });
});

describe("10. messagerie vocale redelivree a une autre instance", () => {
  // La garde etait une Map en memoire : un retry Twilio tombant sur une autre
  // instance Cloud Run consignait le message et renvoyait SMS + e-mail une
  // seconde fois. vi.resetModules() donne un second exemplaire du routeur,
  // avec sa propre memoire — comme une seconde instance.
  it("le meme message recu par deux instances n'est consigne qu'une fois", async () => {
    vi.resetModules();
    const { voiceReceptionistRouter: routeurB } = await import("../routes/voice-receptionist");
    expect(routeurB).not.toBe(voiceReceptionistRouter);
    const instanceB = express();
    instanceB.use(express.urlencoded({ extended: false }));
    instanceB.use("/api", routeurB);

    const sid = `CA${stamp}vm`;
    const chemin = `/api/voice/twilio/voicemail-complete?callSid=${sid}`;
    const params = { AccountSid: A.accountSid, CallSid: sid, From: APPELANT, To: A.numero, RecordingDuration: "12" };
    expect((await twilio(chemin, params, A.token)).status).toBe(200);
    expect((await twilio(chemin, params, A.token, instanceB)).status).toBe(200);

    const journaux = await db.select().from(telephonyCallLogsTable)
      .where(and(eq(telephonyCallLogsTable.organisationId, A.id), eq(telephonyCallLogsTable.providerCallSid, sid)));
    expect(journaux, "message consigne deux fois").toHaveLength(1);
    const evenements = await audit(sid);
    expect(evenements.filter((a) => a === "voice.voicemail.received")).toHaveLength(1);
    const ligne = await etat(sid);
    expect(ligne.status).toBe("terminee");
    // Vieillie de deux heures, elle n'est pas reprise par le balayage des
    // appels abandonnes (elle naît terminee) : pas de second compte rendu.
    await db.update(voiceCallSessionsTable).set({ updatedAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(voiceCallSessionsTable.id, ligne.id));
    await finaliserAppelsAbandonnes();
    expect(await audit(sid)).not.toContain("voice.call.ended");
    preuve("10 messagerie rejouee", { callSid: sid, telephonyLogIds: journaux.map((j) => j.id), sessionId: ligne.id, audit: evenements });
  });
});

describe("gardes transverses", () => {
  it("un appel inconnu du compte est refuse sans rien creer", async () => {
    const r = await twilio("/api/voice/twilio/incoming", { AccountSid: "ACinconnu", CallSid: "CAx", From: APPELANT }, "rien");
    expect(r.status).toBe(403);
  });

  it("aucun etat d'appel ne garde le jeton Twilio", async () => {
    const sid = await appel(A);
    const brut = JSON.stringify((await etat(sid)).state);
    expect(brut).not.toContain(A.token);
    expect(brut).not.toContain("providerConfig");
  });

  it("tous les evenements d'un appel sont dans l'organisation de l'appel", async () => {
    const sid = await appel(A);
    const lignes = await db.select({ org: auditLogsTable.organisationId }).from(auditLogsTable).where(inArray(auditLogsTable.resourceId, [sid]));
    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes.every((l) => l.org === A.id)).toBe(true);
  });
});
