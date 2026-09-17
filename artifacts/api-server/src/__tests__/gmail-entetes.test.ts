/**
 * Un destinataire saisi ne doit pas pouvoir ajouter un entete.
 *
 * Mesure le 17/09 : /gmail/send recopiait `to`, `cc`, `bcc` et l'objet dans les
 * lignes d'entete, jointes par CRLF. « client@exemple.fr\r\nBcc: espion@x.test »
 * ajoutait donc une copie cachee, envoyee depuis la boite Gmail du salarie,
 * invisible a l'ecran, et que le controle DLP (qui lit le champ `to` tel quel)
 * ne voyait pas.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { beforeEach, describe, expect, it, vi } from "vitest";

const envoyes: Array<{ raw: string; threadId?: string }> = [];
vi.mock("../lib/google-auth", () => ({
  getGmailForUser: async () => ({
    users: {
      getProfile: async () => ({ data: { emailAddress: "salarie@entreprise.test" } }),
      messages: {
        send: async ({ requestBody }: any) => {
          envoyes.push({ raw: Buffer.from(requestBody.raw, "base64url").toString("utf8"), threadId: requestBody.threadId });
          return { data: { id: "m1" } };
        },
      },
    },
  }),
  handleGoogleApiError: async () => false,
}));
vi.mock("../services/outgoing-dlp", () => ({ dlpBlocksOutgoing: () => false }));

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import router from "../routes/gmail";
import { adresseSure, enteteSure, objetEncode } from "../services/entetes-courriel";

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: 1, organisationId: 1, userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
const envoyer = (corps: Record<string, unknown>) => request(appli()).post("/api/gmail/send").send({ subject: "Devis", body: "Bonjour", ...corps });

beforeEach(() => { envoyes.length = 0; });

describe("regles pures", () => {
  it("un saut de ligne dans un entete est refuse", () => {
    expect(enteteSure("Devis\r\nBcc: x@y.test")).toBeNull();
    expect(enteteSure("Devis n°12")).toBe("Devis n°12");
  });
  it("une liste d'adresses est normalisee, une adresse douteuse refusee", () => {
    expect(adresseSure(" a@x.fr ,Nom <b@y.fr>")).toBe("a@x.fr, Nom <b@y.fr>");
    expect(adresseSure("a@x.fr\r\nBcc: c@z.fr")).toBeNull();
    expect(adresseSure("pas-une-adresse")).toBeNull();
    expect(adresseSure("")).toBeNull();
  });
  it("l'objet est encode, jamais recopie brut", () => {
    expect(objetEncode("Facture")).toBe(`=?utf-8?B?${Buffer.from("Facture").toString("base64")}?=`);
    expect(objetEncode("Facture\nBcc: x@y.test")).toBeNull();
  });
});

describe("POST /gmail/send", () => {
  it("un envoi normal part avec les bons entetes", async () => {
    const r = await envoyer({ to: "client@exemple.fr" });
    expect(r.status).toBe(200);
    expect(envoyes.length).toBe(1);
    expect(envoyes[0]!.raw).toContain("To: client@exemple.fr");
  });

  it("une copie cachee glissee dans le destinataire est refusee", async () => {
    const r = await envoyer({ to: "client@exemple.fr\r\nBcc: espion@ailleurs.test" });
    expect(r.status).toBe(400);
    expect(envoyes).toEqual([]);
  });

  it("un saut de ligne dans l'objet est refuse", async () => {
    const r = await envoyer({ to: "client@exemple.fr", subject: "Devis\r\nBcc: espion@ailleurs.test" });
    expect(r.status).toBe(400);
    expect(envoyes).toEqual([]);
  });

  it("un entete injecte via Cc est refuse", async () => {
    expect((await envoyer({ to: "a@x.fr", cc: "b@y.fr\nBcc: espion@ailleurs.test" })).status).toBe(400);
    expect(envoyes).toEqual([]);
  });

  it("aucun message envoye ne contient deux lignes Bcc", async () => {
    await envoyer({ to: "a@x.fr", bcc: "compta@entreprise.test" });
    const lignes = envoyes[0]!.raw.split("\r\n").filter((l) => l.startsWith("Bcc:"));
    expect(lignes).toEqual(["Bcc: compta@entreprise.test"]);
  });

  it("une adresse invalide est refusee (pas d'envoi a « moi »)", async () => {
    expect((await envoyer({ to: "moi" })).status).toBe(400);
  });

  it("un corps non textuel est refuse", async () => {
    expect((await envoyer({ to: "a@x.fr", body: { html: "<b>x</b>" } })).status).toBe(400);
  });
});

describe("POST /gmail/reply", () => {
  const repondre = (corps: Record<string, unknown>) => request(appli()).post("/api/gmail/reply").send({ to: "client@exemple.fr", body: "Re", subject: "Devis", ...corps });

  it("la reponse part avec l'objet encode", async () => {
    const r = await repondre({});
    expect(r.status).toBe(200);
    expect(envoyes[0]!.raw).toContain("Subject: =?utf-8?B?");
  });

  it("un identifiant de message avec saut de ligne est refuse", async () => {
    const r = await repondre({ messageId: "abc\r\nBcc: espion@ailleurs.test" });
    expect(r.status).toBe(400);
    expect(envoyes).toEqual([]);
  });

  it("un destinataire injecte est refuse", async () => {
    expect((await repondre({ to: "a@x.fr\r\nBcc: espion@ailleurs.test" })).status).toBe(400);
  });
});
