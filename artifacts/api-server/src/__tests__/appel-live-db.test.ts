/**
 * Appel en direct et reprise par un humain, sur une vraie base, avec les vrais
 * routeurs (appels-live ET la secretaire IA). Twilio est simule : AUCUN compte
 * reel n'existe, ces tests prouvent ce que notre code envoie et comment il
 * reagit aux reponses, pas que Twilio redirige vraiment l'appel.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  auditLogsTable, calendarEventsTable, contactsTable, db, messagesTable, notesInternesTable, organisationsTable,
  tasksTable, telephonyProvidersTable, usersTable, voiceCallSessionsTable,
} from "@workspace/db";

const simu = vi.hoisted(() => ({
  reponses: [] as string[],
  appelsModele: 0,
  pendantModele: null as null | (() => Promise<void>),
}));

vi.mock("../services/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai-providers")>();
  return {
    ...actual,
    callOrgGemini: async () => {
      simu.appelsModele++;
      if (simu.pendantModele) await simu.pendantModele();
      const r = simu.reponses.shift();
      if (r === undefined) throw new Error("[test] aucune reponse de modele en file");
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

import appelsLiveRouter from "../routes/appels-live";
import { voiceReceptionistRouter } from "../routes/voice-receptionist";
import { encryptProviderConfig } from "../services/telephony-providers";
import { definirTwilioHttpPourTests, type TwilioHttp } from "../services/appel-live";

const stamp = Date.now();
let seq = 0;
const sid = () => `CA${stamp}l${++seq}`;
const ids: Record<string, number> = {};
const TOKEN_A = `tok_live_a_${stamp}`;
const ACCOUNT_A = `ACla${stamp}`;
const NUMERO_A = "+33100000071";
const CONSEILLER = "+33700000071";

function appli(userId = ids.adminA, orgId = ids.orgA, role = "administrateur") {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, role, userEmail: `live-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", appelsLiveRouter);
  return a;
}

const voix = express();
voix.use(express.urlencoded({ extended: false }));
voix.use("/api", voiceReceptionistRouter);
function signer(chemin: string, params: Record<string, string>, token: string): string {
  let s = `https://test.local${chemin}`;
  for (const k of Object.keys(params).sort()) s += k + params[k];
  return crypto.createHmac("sha1", token).update(s).digest("base64");
}
function twilio(chemin: string, params: Record<string, string>) {
  return request(voix).post(chemin)
    .set("x-forwarded-proto", "https").set("x-forwarded-host", "test.local")
    .set("x-twilio-signature", signer(chemin, params, TOKEN_A))
    .type("form").send(params);
}
const reponse = (o: Record<string, unknown> = {}) => JSON.stringify({
  say: "Tres bien, je note.", done: false, outcome: null, appointment: null, message: null, transfer: false,
  urgent: false, sentiment: "neutre", summary: "", lang: "fr", confirmation: null, ...o,
});

/** Twilio simule : enregistre chaque requete, repond ce que le test demande. */
const twilioFaux = { requetes: [] as Array<{ url: string; init: Parameters<TwilioHttp>[1] }>, reponse: { ok: true, status: 200, corps: {} as unknown } as { ok: boolean; status: number; corps: unknown } | Error };
const transportFaux: TwilioHttp = async (url, init) => {
  twilioFaux.requetes.push({ url, init });
  await new Promise((r) => setTimeout(r, 20));
  const rep = twilioFaux.reponse;
  if (rep instanceof Error) throw rep;
  return { ok: rep.ok, status: rep.status, json: async () => rep.corps };
};

async function session(orgId: number, v: Partial<typeof voiceCallSessionsTable.$inferInsert> = {}, etat: Record<string, unknown> = {}) {
  const callSid = sid();
  await db.insert(voiceCallSessionsTable).values({
    organisationId: orgId, providerId: null, callSid, status: "en_cours",
    state: {
      callerNumber: "+33611223344", callerName: "Claire Martin", callerContactId: ids.contactA, callCount: 2,
      callerContext: "Devis cuisine en cours", demande: "Je veux un devis",
      turns: [{ role: "user", text: "Bonjour, je veux un devis" }, { role: "assistant", text: "Bien sur, pour quels travaux ?" }],
      journal: ["Appelant reconnu : Claire Martin", "Demande de devis notee"],
      ...etat,
    },
    ...v,
  });
  return callSid;
}
const ligne = async (callSid: string) => (await db.select().from(voiceCallSessionsTable).where(eq(voiceCallSessionsTable.callSid, callSid)))[0]!;
const audits = async (callSid: string) => (await db.select({ action: auditLogsTable.action, org: auditLogsTable.organisationId })
  .from(auditLogsTable).where(eq(auditLogsTable.resourceId, callSid))).map((a) => a.action);

beforeAll(async () => {
  for (const k of ["orgA", "orgB", "orgC", "orgD"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Live ${k} ${stamp}`, slug: `live-${k.toLowerCase()}-${stamp}`, maxUsers: 9, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const mk = async (org: number, role: string, n: string, telephone: string | null = null) => (await db.insert(usersTable).values({ organisationId: org, email: `${n}-${stamp}@exemple.test`, passwordHash: "x", prenom: n, nom: "T", role, actif: true, telephone }).returning({ id: usersTable.id }))[0]!.id;
  ids.adminA = await mk(ids.orgA, "administrateur", "lva", "06 12 34 56 78");
  ids.agentA = await mk(ids.orgA, "agent", "lvg");
  ids.lecteurA = await mk(ids.orgA, "lecture_seule", "lvl");
  ids.adminB = await mk(ids.orgB, "administrateur", "lvb");
  ids.adminC = await mk(ids.orgC, "administrateur", "lvc", "0612345678");
  ids.adminD = await mk(ids.orgD, "administrateur", "lvd");
  // A : Twilio complet, numero de transfert par defaut.
  await db.insert(telephonyProvidersTable).values({
    organisationId: ids.orgA, provider: "twilio", label: "Live A", isActive: true, isDefault: true,
    config: encryptProviderConfig("twilio", {
      accountSid: ACCOUNT_A, authToken: TOKEN_A, fromNumber: NUMERO_A,
      aiReceptionist: { enabled: true, language: "fr", orgName: "Live A", forwardToNumber: CONSEILLER },
    }),
  });
  // B : aucun fournisseur. C : fournisseur sans numero expediteur. D : complet mais personne a joindre.
  await db.insert(telephonyProvidersTable).values({
    organisationId: ids.orgC, provider: "twilio", label: "Live C", isActive: true,
    config: encryptProviderConfig("twilio", { accountSid: `AClc${stamp}`, authToken: `tok_c_${stamp}` }),
  });
  await db.insert(telephonyProvidersTable).values({
    organisationId: ids.orgD, provider: "twilio", label: "Live D", isActive: true,
    config: encryptProviderConfig("twilio", { accountSid: `ACld${stamp}`, authToken: `tok_d_${stamp}`, fromNumber: "+33100000074", aiReceptionist: { enabled: true } }),
  });
  const [c] = await db.insert(contactsTable).values({ organisationId: ids.orgA, firstName: "Claire", lastName: `Martin ${stamp}`, phone: "+33611223344" }).returning({ id: contactsTable.id });
  ids.contactA = c!.id;
}, 60_000);

beforeEach(() => {
  twilioFaux.requetes.length = 0;
  twilioFaux.reponse = { ok: true, status: 200, corps: { sid: "CAx", status: "in-progress" } };
  simu.reponses.length = 0;
  simu.appelsModele = 0;
  simu.pendantModele = null;
  definirTwilioHttpPourTests(transportFaux);
});
afterEach(() => definirTwilioHttpPourTests(null));

describe("liste et detail des appels en direct", () => {
  it("la liste rend l'appel en cours de l'organisation", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).get("/api/appels-live");
    expect(r.status).toBe(200);
    expect(r.body.appels.map((a: any) => a.callSid)).toContain(s);
  });

  it("la liste n'inclut jamais l'appel d'une autre organisation", async () => {
    const s = await session(ids.orgB);
    const r = await request(appli()).get("/api/appels-live");
    expect(r.body.appels.map((a: any) => a.callSid)).not.toContain(s);
    const rb = await request(appli(ids.adminB, ids.orgB)).get("/api/appels-live");
    expect(rb.body.appels.map((a: any) => a.callSid)).toContain(s);
  });

  it("un appel termine n'est plus en direct", async () => {
    const s = await session(ids.orgA, { status: "terminee" });
    const r = await request(appli()).get("/api/appels-live");
    expect(r.body.appels.map((a: any) => a.callSid)).not.toContain(s);
  });

  it("un appel muet depuis plus de 30 min n'est plus en direct", async () => {
    const s = await session(ids.orgA, { updatedAt: new Date(Date.now() - 31 * 60_000) });
    const r = await request(appli()).get("/api/appels-live");
    expect(r.body.appels.map((a: any) => a.callSid)).not.toContain(s);
  });

  it("un appel finalise (compte rendu ecrit) n'est plus en direct, meme si le statut a pris du retard", async () => {
    const s = await session(ids.orgA, { finalizedAt: new Date() });
    const r = await request(appli()).get("/api/appels-live");
    expect(r.body.appels.map((a: any) => a.callSid)).not.toContain(s);
  });

  it("la liste masque le numero et ne renvoie pas l'etat brut", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).get("/api/appels-live");
    const a = r.body.appels.find((x: any) => x.callSid === s);
    expect(a.numeroMasque).not.toContain("223344");
    expect(a.state).toBeUndefined();
    expect(a.appelant).toBe("Claire Martin");
    expect(a.dernierJournal).toBe("Demande de devis notee");
  });

  it("le detail rend la transcription, le journal et l'etape de l'agent", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).get(`/api/appels-live/${s}`);
    expect(r.status).toBe(200);
    expect(r.body.tours).toEqual([{ role: "user", texte: "Bonjour, je veux un devis" }, { role: "assistant", texte: "Bien sur, pour quels travaux ?" }]);
    expect(r.body.journal).toHaveLength(2);
    expect(r.body.etape).toBe("ecoute");
    expect(r.body.enDirect).toBe(true);
    expect(r.body.appelant).toMatchObject({ nom: "Claire Martin", contactId: ids.contactA, appelsPrecedents: 2, contexte: "Devis cuisine en cours" });
  });

  it("le detail d'un appel d'une autre organisation rend 404", async () => {
    const s = await session(ids.orgB);
    const r = await request(appli()).get(`/api/appels-live/${s}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain("Claire");
  });

  it("un CallSid inconnu ou mal forme rend 404", async () => {
    expect((await request(appli()).get(`/api/appels-live/CAinconnu${stamp}`)).status).toBe(404);
    expect((await request(appli()).get(`/api/appels-live/${encodeURIComponent("x' or 1=1")}`)).status).toBe(404);
  });

  it("un secret glisse dans l'etat ne sort jamais du detail ni de la liste", async () => {
    const s = await session(ids.orgA, {}, { providerConfig: { authToken: TOKEN_A }, cfg: { secret: TOKEN_A } });
    const d = await request(appli()).get(`/api/appels-live/${s}`);
    const l = await request(appli()).get("/api/appels-live");
    expect(d.text).not.toContain(TOKEN_A);
    expect(l.text).not.toContain(TOKEN_A);
  });

  it("l'etape suit l'etat : creneau propose, puis transfert", async () => {
    const a = await session(ids.orgA, {}, { rdvPropose: { debutIso: "2026-10-05T08:00:00Z", motif: "Visite" } });
    const b = await session(ids.orgA, { status: "transfert" }, { transfert: { statut: "en_cours", equipe: "Chantier" } });
    expect((await request(appli()).get(`/api/appels-live/${a}`)).body.etape).toBe("rdv_propose");
    const rb = await request(appli()).get(`/api/appels-live/${b}`);
    expect(rb.body.etape).toBe("transfert");
    expect(rb.body.transfert).toEqual({ statut: "en_cours", equipe: "Chantier" });
  });
});

describe("capacite et reprise de l'appel", () => {
  it("sans fournisseur : reprise impossible, raison dite", async () => {
    const r = await request(appli(ids.adminB, ids.orgB)).get("/api/appels-live/capacite");
    expect(r.body).toMatchObject({ fournisseur: null, reprisePossible: false, raison: "aucun_fournisseur" });
  });

  it("fournisseur sans numero expediteur : reprise impossible (callerId inconnu)", async () => {
    const r = await request(appli(ids.adminC, ids.orgC)).get("/api/appels-live/capacite");
    expect(r.body).toMatchObject({ fournisseur: "twilio", reprisePossible: false, raison: "fournisseur_incomplet" });
  });

  it("fournisseur complet mais personne a joindre : raison aucun_numero", async () => {
    const r = await request(appli(ids.adminD, ids.orgD)).get("/api/appels-live/capacite");
    expect(r.body).toMatchObject({ reprisePossible: false, raison: "aucun_numero" });
  });

  it("capacite complete : cibles masquees, aucun secret", async () => {
    const r = await request(appli()).get("/api/appels-live/capacite");
    expect(r.body.reprisePossible).toBe(true);
    expect(r.body.cibles.map((c: any) => c.id)).toEqual(["moi", "defaut"]);
    expect(r.text).not.toContain(TOKEN_A);
    expect(r.text).not.toContain(ACCOUNT_A);
    expect(r.text).not.toContain("700000071");
    expect(r.text).not.toContain("612345678");
  });

  it("reprise sans fournisseur : 409 avec la raison, Twilio jamais appele, rien revendique", async () => {
    const s = await session(ids.orgB);
    const r = await request(appli(ids.adminB, ids.orgB)).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("aucun_fournisseur");
    expect(twilioFaux.requetes).toHaveLength(0);
    expect((await ligne(s)).takeoverStatus).toBeNull();
  });

  it("reprise acceptee par Twilio : redirection <Dial> avec le numero de l'entreprise, statut reussi, audit", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" });
    expect(r.status, r.text).toBe(200);
    expect(twilioFaux.requetes).toHaveLength(1);
    const q = twilioFaux.requetes[0]!;
    expect(q.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_A}/Calls/${s}.json`);
    expect(q.init.headers.Authorization).toBe("Basic " + Buffer.from(`${ACCOUNT_A}:${TOKEN_A}`).toString("base64"));
    const twiml = new URLSearchParams(q.init.body).get("Twiml")!;
    expect(twiml).toBe(`<Response><Dial callerId="${NUMERO_A}"><Number>+33612345678</Number></Dial></Response>`);
    const l = await ligne(s);
    expect(l.takeoverStatus).toBe("reussi");
    expect(l.takenOverByUserId).toBe(ids.adminA);
    expect(l.status).toBe("transfert");
    expect(await audits(s)).toContain("appel.repris");
    expect(r.text).not.toContain(TOKEN_A);
    expect((await request(appli()).get(`/api/appels-live/${s}`)).body.etape).toBe("reprise_humaine");
  });

  it("Twilio refuse : la revendication est rendue et la vraie raison remontee", async () => {
    twilioFaux.reponse = { ok: false, status: 400, corps: { code: 21220, message: "Call is not in-progress. Cannot redirect." } };
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "defaut" });
    expect(r.status).toBe(502);
    expect(r.body.raison).toBe("Call is not in-progress. Cannot redirect.");
    const l = await ligne(s);
    expect(l.takeoverStatus).toBeNull();
    expect(l.takenOverByUserId).toBeNull();
    expect(l.status).toBe("en_cours");
    expect(await audits(s)).toContain("appel.reprise_echouee");
  });

  it("Twilio injoignable (exception reseau) : revendication rendue, 502", async () => {
    twilioFaux.reponse = new Error("connect ECONNREFUSED");
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" });
    expect(r.status).toBe(502);
    expect(r.body.raison).toContain("ECONNREFUSED");
    expect((await ligne(s)).takeoverStatus).toBeNull();
  });

  it("le message d'erreur Twilio ne fait jamais ressortir le jeton", async () => {
    twilioFaux.reponse = { ok: false, status: 401, corps: { message: `Authenticate ${TOKEN_A} invalide` } };
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" });
    expect(r.status).toBe(502);
    expect(r.text).not.toContain(TOKEN_A);
  });

  it("deux reprises simultanees : une seule gagne, Twilio appele une seule fois", async () => {
    const s = await session(ids.orgA);
    const [a, b] = await Promise.all([
      request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" }),
      request(appli(ids.agentA)).post(`/api/appels-live/${s}/devral`).send({ cible: "defaut" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(twilioFaux.requetes).toHaveLength(1);
  });

  it("un appel deja repris : 409 deja_repris", async () => {
    const s = await session(ids.orgA);
    expect((await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" })).status).toBe(200);
    const r = await request(appli(ids.agentA)).post(`/api/appels-live/${s}/devral`).send({ cible: "defaut" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("deja_repris");
  });

  it("un appel termine : 409 termine, Twilio jamais appele", async () => {
    const s = await session(ids.orgA, { status: "terminee" });
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("termine");
    expect(twilioFaux.requetes).toHaveLength(0);
  });

  it("l'appel d'une autre organisation : 404, Twilio jamais appele", async () => {
    const s = await session(ids.orgB);
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" });
    expect(r.status).toBe(404);
    expect(twilioFaux.requetes).toHaveLength(0);
    expect((await ligne(s)).takeoverStatus).toBeNull();
  });

  it("un compte en lecture seule ne reprend pas un appel", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli(ids.lecteurA, ids.orgA, "lecture_seule")).post(`/api/appels-live/${s}/devral`).send({ cible: "defaut" });
    expect(r.status).toBe(403);
    expect(twilioFaux.requetes).toHaveLength(0);
  });

  it("une cible inconnue (numero choisi par le client) est refusee", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "+33999999999" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("cible_inconnue");
    expect(twilioFaux.requetes).toHaveLength(0);
  });
});

describe("l'IA se tait apres la reprise, et les actions de l'ecran", () => {
  async function appelReel(): Promise<string> {
    const callSid = sid();
    const r = await twilio("/api/voice/twilio/incoming", { AccountSid: ACCOUNT_A, CallSid: callSid, From: "+33611223344", To: NUMERO_A });
    expect(r.status, r.text).toBe(200);
    return callSid;
  }
  const parle = (callSid: string, texte: string) =>
    twilio("/api/voice/twilio/respond", { AccountSid: ACCOUNT_A, CallSid: callSid, From: "+33611223344", To: NUMERO_A, SpeechResult: texte });
  const toursIa = async (callSid: string) => (((await ligne(callSid)).state as any).turns ?? []).filter((t: any) => t.role === "assistant").length;

  it("avant la reprise, l'IA repond normalement (temoin)", async () => {
    const s = await appelReel();
    const avant = await toursIa(s);
    simu.reponses.push(reponse());
    const r = await parle(s, "Bonjour je veux un devis");
    expect(r.text).toContain("<Say");
    expect(await toursIa(s)).toBe(avant + 1);
  });

  it("apres la reprise, /respond ne produit aucun tour IA et n'appelle pas le modele", async () => {
    const s = await appelReel();
    const avant = await toursIa(s);
    expect((await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" })).status).toBe(200);
    simu.reponses.push(reponse());
    const r = await parle(s, "Allo ?");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("<Say");
    expect(r.text).toContain("<Pause");
    expect(simu.appelsModele).toBe(0);
    expect(await toursIa(s)).toBe(avant);
  });

  it("reprise pendant que le modele reflechit : le tour calcule n'est ni enregistre ni dit", async () => {
    const s = await appelReel();
    simu.reponses.push(reponse({ say: "PHRASE_IA_TARDIVE" }));
    simu.pendantModele = async () => {
      simu.pendantModele = null;
      expect((await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" })).status).toBe(200);
    };
    const r = await parle(s, "Je veux parler a quelqu'un");
    expect(simu.appelsModele).toBe(1);
    expect(r.text).not.toContain("PHRASE_IA_TARDIVE");
    expect(r.text).toContain("<Pause");
    expect(JSON.stringify((await ligne(s)).state)).not.toContain("PHRASE_IA_TARDIVE");
  });

  it("apres une reprise echouee (revendication rendue), l'IA reprend la main", async () => {
    const s = await appelReel();
    twilioFaux.reponse = { ok: false, status: 404, corps: { message: "The requested resource was not found" } };
    expect((await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" })).status).toBe(502);
    const avant = await toursIa(s);
    simu.reponses.push(reponse());
    const r = await parle(s, "Toujours la ?");
    expect(r.text).toContain("<Say");
    expect(await toursIa(s)).toBe(avant + 1);
  });

  it("apres la reprise, /transfert-resultat ne cree ni rappel ni tour IA", async () => {
    const s = await appelReel();
    expect((await request(appli()).post(`/api/appels-live/${s}/devral`).send({ cible: "moi" })).status).toBe(200);
    const avant = (await db.select().from(messagesTable).where(eq(messagesTable.organisationId, ids.orgA))).length;
    const r = await twilio("/api/voice/twilio/transfert-resultat", { AccountSid: ACCOUNT_A, CallSid: s, DialCallStatus: "no-answer" });
    expect(r.text).not.toContain("<Say");
    expect((await db.select().from(messagesTable).where(eq(messagesTable.organisationId, ids.orgA))).length).toBe(avant);
  });

  it("creer une tache depuis l'appel : liee a l'appel et au contact, auditee", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/tache`).send({ titre: "Rappeler pour le devis", description: "Cuisine" });
    expect(r.status).toBe(201);
    const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, r.body.id));
    expect(t!.organisationId).toBe(ids.orgA);
    expect(t!.relatedContactId).toBe(ids.contactA);
    expect(t!.description).toContain(s);
    expect(t!.createdBy).toBe(ids.adminA);
    expect((await ligne(s)).actions).toMatchObject({ [`ecran:tache:${t!.id}`]: true });
    const [a] = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.resource, "task"), eq(auditLogsTable.resourceId, String(t!.id))));
    expect(a!.organisationId).toBe(ids.orgA);
  });

  it("une tache sans titre est refusee", async () => {
    const s = await session(ids.orgA);
    expect((await request(appli()).post(`/api/appels-live/${s}/tache`).send({ titre: "  " })).status).toBe(400);
  });

  it("enregistrer une note : note interne etiquetee avec l'appel", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli()).post(`/api/appels-live/${s}/note`).send({ contenu: "Client presse, budget 15 k" });
    expect(r.status).toBe(201);
    const [n] = await db.select().from(notesInternesTable).where(eq(notesInternesTable.id, r.body.id));
    expect(n!.organisationId).toBe(ids.orgA);
    expect(n!.tags).toEqual(["appel", s]);
    expect(n!.content).toBe("Client presse, budget 15 k");
  });

  it("ouvrir un rendez-vous de decouverte : evenement sans chantier, avec l'appelant", async () => {
    const s = await session(ids.orgA);
    const debut = new Date(Date.now() + 3 * 86400_000);
    const r = await request(appli()).post(`/api/appels-live/${s}/rdv-decouverte`).send({ debut: debut.toISOString(), lieu: "12 rue des Lilas" });
    expect(r.status).toBe(201);
    const [e] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, r.body.id));
    expect(e!.projetId).toBeNull();
    expect(e!.relatedContactId).toBe(ids.contactA);
    expect(e!.contactPhone).toBe("+33611223344");
    expect(e!.endDate.getTime() - e!.startDate.getTime()).toBe(60 * 60_000);
    expect(e!.description).toContain(s);
  });

  it("un rendez-vous sans date valide est refuse", async () => {
    const s = await session(ids.orgA);
    expect((await request(appli()).post(`/api/appels-live/${s}/rdv-decouverte`).send({ debut: "demain" })).status).toBe(400);
  });

  it("une action sur l'appel d'une autre organisation rend 404 et n'ecrit rien", async () => {
    const s = await session(ids.orgB);
    for (const [chemin, corps] of [["tache", { titre: "x" }], ["note", { contenu: "x" }], ["rdv-decouverte", { debut: new Date().toISOString() }]] as const) {
      const r = await request(appli()).post(`/api/appels-live/${s}/${chemin}`).send(corps);
      expect(r.status, chemin).toBe(404);
    }
    expect((await ligne(s)).actions).toEqual({});
  });

  it("un compte en lecture seule n'ecrit rien depuis l'appel", async () => {
    const s = await session(ids.orgA);
    const r = await request(appli(ids.lecteurA, ids.orgA, "lecture_seule")).post(`/api/appels-live/${s}/note`).send({ contenu: "x" });
    expect(r.status).toBe(403);
  });
});

describe("une reprise arrete aussi l'agenda et le rappel de l'IA", () => {
  it("apres la reprise, l'IA n'inscrit plus de rendez-vous", async () => {
    const { creerRendezVousConfirme } = await import("../services/standard-telephonique");
    const s = await session(ids.orgA, { takeoverStatus: "reussi" } as any);
    const debut = new Date("2026-11-03T09:00:00.000Z");
    const r = await creerRendezVousConfirme({ orgId: ids.orgA, callSid: s, debut, fin: new Date(debut.getTime() + 3600e3), nom: "Claire", motif: "Devis", telephone: "+33611223344", contactId: null });
    expect(r).toEqual({ repris: true });
    const evts = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.externalRef, `voice:${s}`));
    expect(evts).toHaveLength(0);
  });

  it("sans reprise, le meme rendez-vous s'inscrit (controle negatif)", async () => {
    const { creerRendezVousConfirme } = await import("../services/standard-telephonique");
    const s = await session(ids.orgA);
    const debut = new Date("2026-11-04T09:00:00.000Z");
    const r = await creerRendezVousConfirme({ orgId: ids.orgA, callSid: s, debut, fin: new Date(debut.getTime() + 3600e3), nom: "Claire", motif: "Devis", telephone: "+33611223344", contactId: null });
    expect("eventId" in r && r.nouveau).toBe(true);
  });

  it("une revendication d'action IA echoue apres la reprise ; la finalisation passe toujours", async () => {
    const { revendiquerAction } = await import("../services/standard-telephonique");
    const s = await session(ids.orgA, { takeoverStatus: "reussi" } as any);
    expect(await revendiquerAction(s, ids.orgA, "rappel", true, { siNonRepris: true })).toBe(false);
    expect(await revendiquerAction(s, ids.orgA, "finalisation")).toBe(true);
  });
});
