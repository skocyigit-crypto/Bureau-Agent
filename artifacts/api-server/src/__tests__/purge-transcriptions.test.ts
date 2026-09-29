/**
 * Les transcriptions d'appel s'effacent a 12 mois, dans les trois copies
 * que `telephony_call_logs` ne couvrait pas : notes d'appel, message vocal,
 * notification. Ce qui n'est pas une transcription reste.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db, organisationsTable, callsTable, messagesTable, notificationsTable, telephonyCallLogsTable,
} from "@workspace/db";
import { MARQUEUR_EFFACE, purgerTranscriptionsExpirees, retirerTranscription } from "../services/purge-transcriptions";

const SECRETAIRE = [
  "[Resume IA] Demande de rendez-vous mardi.",
  "",
  "[Secretaire telephonique IA]",
  "Secretaire: Bonjour, cabinet Durand.",
  "Appelant: Bonjour, je voudrais un rendez-vous.",
  "Secretaire: Mardi 14 h vous convient ?",
].join("\n");

const AGENT = [
  "[Appel gere par IA Sophie - Score satisfaction: 8/10]",
  "Resume: Devis cuisine",
  "Transcription:",
  "[Sophie] Bonjour !",
  "[Client] Je voudrais un devis.",
].join("\n");

describe("retirerTranscription", () => {
  it("secretaire IA : le resume reste, l'echange part", () => {
    const r = retirerTranscription(SECRETAIRE)!;
    expect(r).toContain("[Resume IA] Demande de rendez-vous mardi.");
    expect(r).toContain(MARQUEUR_EFFACE);
    expect(r).not.toContain("Appelant:");
  });
  it("agent IA : l'en-tete et le resume restent, les repliques partent", () => {
    const r = retirerTranscription(AGENT)!;
    expect(r).toContain("Resume: Devis cuisine");
    expect(r).not.toContain("[Client]");
    expect(r).not.toContain("[Sophie] Bonjour");
  });
  it("une note ajoutee par le client apres l'appel est gardee", () => {
    const r = retirerTranscription(`${SECRETAIRE}\nRappele le 3/10 : RDV confirme.`)!;
    expect(r.endsWith("Rappele le 3/10 : RDV confirme.")).toBe(true);
  });
  it("deja effacee : rien a faire", () => {
    expect(retirerTranscription(retirerTranscription(SECRETAIRE)!)).toBeNull();
  });
  it("une note sans transcription n'est pas touchee", () => {
    expect(retirerTranscription("Client a rappeler demain.")).toBeNull();
  });
  it("un en-tete sans replique n'est pas touche", () => {
    expect(retirerTranscription("[Secretaire telephonique IA]\n")).toBeNull();
  });
  it("les fins de ligne Windows ne cachent pas la transcription", () => {
    expect(retirerTranscription(SECRETAIRE.replace(/\n/g, "\r\n"))).toContain(MARQUEUR_EFFACE);
  });
  it.each(["Arayan", "Caller", "Llamante", "Anrufer", "Sekreter", "Receptionist"])("replique en langue etrangere (%s)", (etiquette) => {
    const r = retirerTranscription(`[Secretaire telephonique IA]\n${etiquette}: texte`)!;
    expect(r).not.toContain(`${etiquette}: texte`);
  });
  it("la ligne « [Resume IA] ... » avant l'en-tete n'est pas prise pour une replique", () => {
    expect(retirerTranscription(SECRETAIRE)!.startsWith("[Resume IA]")).toBe(true);
  });
  it("limite assumee : la suite d'une replique sur plusieurs lignes reste", () => {
    const r = retirerTranscription("[Secretaire telephonique IA]\nAppelant: ligne un\nsuite de la ligne")!;
    expect(r).toContain("suite de la ligne");
    expect(r).not.toContain("ligne un");
  });
});

describe("sur la base : les trois copies", () => {
  const stamp = Date.now();
  const vieux = new Date(Date.now() - 400 * 86400_000);
  const limite = new Date(Date.now() - 365 * 86400_000);
  let orgId = 0;
  const idsAppels: number[] = [];
  let vocal = 0, autreMessage = 0, notifVocal = 0, autreNotif = 0;

  beforeAll(async () => {
    const [o] = await db.insert(organisationsTable).values({ name: `Transcriptions ${stamp}`, slug: `transcriptions-${stamp}`, maxUsers: 3, actif: true }).returning({ id: organisationsTable.id });
    orgId = o!.id;
    const appels = await db.insert(callsTable).values([
      { organisationId: orgId, phoneNumber: "0601", direction: "entrant", status: "termine", notes: SECRETAIRE, createdAt: vieux },
      { organisationId: orgId, phoneNumber: "0602", direction: "entrant", status: "termine", notes: SECRETAIRE },
    ]).returning({ id: callsTable.id });
    idsAppels.push(...appels.map((a) => a.id));
    const texte = `Bonjour, c'est Paul, rappelez-moi ${stamp}.`;
    const [m1] = await db.insert(messagesTable).values({ organisationId: orgId, phoneNumber: "0603", content: texte, type: "appel", createdAt: vieux }).returning({ id: messagesTable.id });
    const [m2] = await db.insert(messagesTable).values({ organisationId: orgId, phoneNumber: "0604", content: "Rappel demande par le client.", type: "appel", createdAt: vieux }).returning({ id: messagesTable.id });
    vocal = m1!.id; autreMessage = m2!.id;
    await db.insert(telephonyCallLogsTable).values({
      organisationId: orgId, providerCallSid: `CA${stamp}`, direction: "inbound", fromNumber: "0603", toNumber: "0100",
      status: "completed", transcription: texte, metadata: { aiReceptionist: true, voicemail: true }, createdAt: vieux,
    });
    const [n1] = await db.insert(notificationsTable).values({ organisationId: orgId, type: "info", title: "Nouveau message vocal (repondeur)", message: texte.slice(0, 140), sourceType: "ai_receptionist_voicemail", createdAt: vieux }).returning({ id: notificationsTable.id });
    const [n2] = await db.insert(notificationsTable).values({ organisationId: orgId, type: "info", title: "Tache", message: "Tache en retard", createdAt: vieux }).returning({ id: notificationsTable.id });
    notifVocal = n1!.id; autreNotif = n2!.id;
  }, 60_000);

  afterAll(async () => {
    try {
      await db.delete(callsTable).where(inArray(callsTable.id, idsAppels));
      await db.delete(messagesTable).where(eq(messagesTable.organisationId, orgId));
      await db.delete(notificationsTable).where(eq(notificationsTable.organisationId, orgId));
      await db.delete(telephonyCallLogsTable).where(eq(telephonyCallLogsTable.organisationId, orgId));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
    } catch { /* base jetable */ }
  });

  let bilan: Awaited<ReturnType<typeof purgerTranscriptionsExpirees>>;
  beforeAll(async () => { bilan = await purgerTranscriptionsExpirees(limite); });

  const lire = async <T extends { id: unknown }>(table: any, id: number): Promise<T> =>
    (await db.select().from(table).where(eq(table.id, id)))[0] as T;

  it("l'appel de plus de 12 mois perd son echange, garde son resume", async () => {
    const a = await lire<{ id: number; notes: string }>(callsTable, idsAppels[0]!);
    expect(a.notes).not.toContain("Appelant:");
    expect(a.notes).toContain("[Resume IA]");
  });
  it("l'appel recent garde sa transcription", async () => {
    expect((await lire<{ id: number; notes: string }>(callsTable, idsAppels[1]!)).notes).toContain("Appelant:");
  });
  it("le message vocal perd sa transcription", async () => {
    expect((await lire<{ id: number; content: string }>(messagesTable, vocal)).content).toContain(MARQUEUR_EFFACE);
  });
  it("un autre message du meme age garde son texte", async () => {
    expect((await lire<{ id: number; content: string }>(messagesTable, autreMessage)).content).toBe("Rappel demande par le client.");
  });
  it("la notification du repondeur perd son extrait", async () => {
    expect((await lire<{ id: number; message: string }>(notificationsTable, notifVocal)).message).toContain(MARQUEUR_EFFACE);
  });
  it("une autre notification garde son texte", async () => {
    expect((await lire<{ id: number; message: string }>(notificationsTable, autreNotif)).message).toBe("Tache en retard");
  });
  it("le bilan compte ce qui a ete reecrit", () => {
    expect(bilan.appels).toBeGreaterThanOrEqual(1);
    expect(bilan.messagesVocaux).toBeGreaterThanOrEqual(1);
    expect(bilan.notifications).toBeGreaterThanOrEqual(1);
  });
  it("le passage quotidien efface les copies AVANT le journal telephonique (sinon le message vocal n'est plus reconnaissable)", async () => {
    const { purgeExpiredCallRecordings } = await import("../services/retention-cron");
    const texte = `Message vocal du passage quotidien ${stamp}`;
    const [m] = await db.insert(messagesTable).values({ organisationId: orgId, phoneNumber: "0605", content: texte, type: "appel", createdAt: vieux }).returning({ id: messagesTable.id });
    await db.insert(telephonyCallLogsTable).values({
      organisationId: orgId, providerCallSid: `CA2${stamp}`, direction: "inbound", fromNumber: "0605", toNumber: "0100",
      status: "completed", transcription: texte, metadata: { aiReceptionist: true, voicemail: true }, createdAt: vieux,
    });
    await purgeExpiredCallRecordings();
    expect((await lire<{ id: number; content: string }>(messagesTable, m!.id)).content).toContain(MARQUEUR_EFFACE);
    const journaux = await db.select().from(telephonyCallLogsTable).where(eq(telephonyCallLogsTable.providerCallSid, `CA2${stamp}`));
    expect(journaux[0]!.transcription).toBeNull();
  });

  it("un second passage ne reecrit rien de cette organisation", async () => {
    const avant = await lire<{ id: number; notes: string }>(callsTable, idsAppels[0]!);
    await purgerTranscriptionsExpirees(limite);
    expect((await lire<{ id: number; notes: string }>(callsTable, idsAppels[0]!)).notes).toBe(avant.notes);
  });
});
