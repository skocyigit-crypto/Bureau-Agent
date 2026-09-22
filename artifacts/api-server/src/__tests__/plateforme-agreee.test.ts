/**
 * Transmission des factures a la plateforme agreee (API AFNOR XP Z12-013).
 *
 * Les requetes sont verifiees contre la SPECIFICATION OFFICIELLE
 * (fixtures/afnor-xp-z12-013-flow-1.3.0.json, telle que publiee par les
 * plateformes), pas contre une recopie faite dans ce depot : un test qui
 * validerait nos requetes contre nos propres suppositions ne prouverait rien.
 *
 * Une fausse plateforme tourne en local ; les routes sont les vraies, la base
 * aussi.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable, plateformesAgreeesTable } from "@workspace/db";
import router from "../routes/plateforme-agreee";
import { encryptSensitiveData } from "../lib/crypto";
import { oublierJeton } from "../services/plateforme-agreee";
import { tickPlateformeAgreee } from "../services/plateforme-agreee-cron";

// ── La specification officielle ─────────────────────────────────────────────
const SPEC = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "afnor-xp-z12-013-flow-1.3.0.json"), "utf8"));
const S = SPEC.components.schemas;
const ENUM = (nom: string): string[] => S[nom].enum;

// ── La fausse plateforme ────────────────────────────────────────────────────
interface Depot { flowInfo: Record<string, unknown>; fichier: Buffer; typeFichier: string; nomFichier: string }
const pa = {
  jetonsDelivres: 0,
  depots: [] as Depot[],
  recherches: [] as Record<string, unknown>[],
  statutDepot: 202,
  accuseRecherche: "Ok" as "Pending" | "Ok" | "Error",
  fluxRecus: [] as unknown[],
};
let serveurPA: Server;
let urlPA = "";

function demarrerPA(): Promise<void> {
  const app = express();
  app.post("/oauth2/token", express.urlencoded({ extended: false }), (req, res) => {
    if (req.body.grant_type !== "client_credentials" || req.body.client_secret !== "secret-de-test") {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    pa.jetonsDelivres++;
    res.json({ access_token: `jeton-${pa.jetonsDelivres}`, token_type: "Bearer", expires_in: 3600 });
  });
  const auth = (req: Request, res: Response, next: NextFunction) => {
    if (!String(req.headers.authorization ?? "").startsWith("Bearer jeton-")) { res.status(401).end(); return; }
    next();
  };
  app.get("/afnor-flow/v1/healthcheck", auth, (_req, res) => { res.status(200).end(); });
  app.post("/afnor-flow/v1/flows", auth, express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
    // Le multipart est lu par le parseur du standard web, pas par une regex.
    const form = await new globalThis.Response(req.body, { headers: { "content-type": String(req.headers["content-type"]) } }).formData();
    const info = form.get("flowInfo") as Blob;
    const fichier = form.get("file") as File;
    pa.depots.push({
      flowInfo: JSON.parse(await info.text()),
      fichier: Buffer.from(await fichier.arrayBuffer()),
      typeFichier: fichier.type,
      nomFichier: fichier.name,
    });
    if (pa.statutDepot !== 202) { res.status(pa.statutDepot).json({ errorCode: "X", errorMessage: "refus" }); return; }
    res.status(202).json({ flowId: `flux-${pa.depots.length}`, submittedAt: new Date().toISOString(), ...JSON.parse(await info.text()) });
  });
  app.post("/afnor-flow/v1/flows/search", auth, express.json(), (req, res) => {
    pa.recherches.push(req.body);
    const where = req.body.where ?? {};
    if (Array.isArray(where.flowDirection) && where.flowDirection.includes("In")) {
      res.json({ results: pa.fluxRecus, limit: req.body.limit });
      return;
    }
    res.json({
      results: [{
        flowId: "flux-1", trackingId: where.trackingId, submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        flowSyntax: "Factur-X", flowProfile: "Basic", processingRule: "B2B", flowDirection: "Out", flowType: "CustomerInvoice",
        processingRuleSource: "Input", name: "x.pdf",
        acknowledgement: pa.accuseRecherche === "Error"
          ? { status: "Error", details: [{ item: "BT-48", level: "Error", reasonCode: "REJ_SEMAN", reasonMessage: "TVA acheteur invalide" }] }
          : { status: pa.accuseRecherche },
      }],
    });
  });
  return new Promise((ok) => {
    serveurPA = app.listen(0, "127.0.0.1", () => {
      urlPA = `http://127.0.0.1:${(serveurPA.address() as AddressInfo).port}`;
      ok();
    });
  });
}

// ── L'application ───────────────────────────────────────────────────────────
const stamp = Date.now();
let orgA = 0;
let orgB = 0;

function appli(orgId: number, role = "administrateur") {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: 1, organisationId: orgId, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function org(nom: string): Promise<number> {
  const [o] = await db.insert(organisationsTable).values({
    name: `${nom} ${stamp}`, slug: `pa-${nom}-${stamp}`, email: `pa-${nom}-${stamp}@example.test`,
    phone: "+33123456789", maxUsers: 5, actif: true, siret: "89097764800017",
  }).returning({ id: organisationsTable.id });
  return o!.id;
}

async function facture(orgId: number, status: string, ref: string): Promise<number> {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `${ref}-${stamp}`, title: "Travaux", clientName: "Client SAS",
    clientSiren: "552100554", items: [{ description: "Pose", quantity: 1, unitPrice: 100, vatRate: 20 }] as any,
    subtotal: "100", taxAmount: "20", totalAmount: "100", status,
  }).returning({ id: facturesClientTable.id });
  return f!.id;
}

async function raccorder(orgId: number) {
  await db.delete(plateformesAgreeesTable).where(eq(plateformesAgreeesTable.organisationId, orgId));
  // Insere directement : la route refuse (a juste titre) une adresse locale.
  await db.insert(plateformesAgreeesTable).values({
    organisationId: orgId, nom: "PA de test",
    urlFlow: `${urlPA}/afnor-flow`, urlJeton: `${urlPA}/oauth2/token`,
    clientId: "client-test", clientSecretChiffre: encryptSensitiveData("secret-de-test"),
  });
  oublierJeton({ organisationId: orgId, urlJeton: `${urlPA}/oauth2/token`, clientId: "client-test", urlFlow: "", clientSecret: "" });
}

const ligne = async (id: number) => (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0]!;

beforeAll(async () => {
  await demarrerPA();
  orgA = await org("a");
  orgB = await org("b");
}, 60_000);

afterAll(async () => {
  serveurPA?.close();
  for (const o of [orgA, orgB]) {
    await db.delete(plateformesAgreeesTable).where(eq(plateformesAgreeesTable.organisationId, o));
    await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, o));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
  }
});

beforeEach(() => {
  pa.depots.length = 0;
  pa.recherches.length = 0;
  pa.statutDepot = 202;
  pa.accuseRecherche = "Ok";
  pa.fluxRecus = [];
});

// ── Raccordement ────────────────────────────────────────────────────────────
describe("raccordement", () => {
  it("refuse une adresse en http", async () => {
    const r = await request(appli(orgA)).put("/api/plateforme-agreee")
      .send({ nom: "X", urlFlow: "http://api.example.com/afnor-flow", urlJeton: "https://api.example.com/oauth2/token", clientId: "c", clientSecret: "s" });
    expect(r.status).toBe(400);
  });

  it("refuse une adresse interne (garde anti-SSRF)", async () => {
    const r = await request(appli(orgA)).put("/api/plateforme-agreee")
      .send({ nom: "X", urlFlow: "https://127.0.0.1/afnor-flow", urlJeton: "https://169.254.169.254/token", clientId: "c", clientSecret: "s" });
    expect(r.status).toBe(400);
  });

  it("chiffre le secret et ne le renvoie jamais", async () => {
    await raccorder(orgA);
    const [enBase] = await db.select().from(plateformesAgreeesTable).where(eq(plateformesAgreeesTable.organisationId, orgA));
    expect(enBase!.clientSecretChiffre).not.toContain("secret-de-test");
    const r = await request(appli(orgA)).get("/api/plateforme-agreee");
    expect(r.body.secretEnregistre).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("secret-de-test");
    expect(JSON.stringify(r.body)).not.toContain(enBase!.clientSecretChiffre);
  });

  it("un agent n'y accede pas", async () => {
    expect((await request(appli(orgA, "agent")).get("/api/plateforme-agreee")).status).toBe(403);
    expect((await request(appli(orgA, "agent")).post("/api/factures-client/1/transmettre")).status).toBe(403);
  });

  it("le test de raccordement obtient un jeton et interroge la plateforme", async () => {
    await raccorder(orgA);
    const r = await request(appli(orgA)).post("/api/plateforme-agreee/test");
    expect(r.status).toBe(200);
  });
});

// ── Depot ───────────────────────────────────────────────────────────────────
describe("depot d'une facture emise", () => {
  it("un brouillon n'est pas transmis", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "brouillon", "BR");
    const r = await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    expect(r.status).toBe(409);
    expect(pa.depots).toEqual([]);
  });

  it("sans raccordement, la reponse le dit", async () => {
    const id = await facture(orgB, "envoyee", "SR");
    const r = await request(appli(orgB)).post(`/api/factures-client/${id}/transmettre`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Aucune plateforme/);
  });

  it("la facture d'une autre organisation est introuvable", async () => {
    await raccorder(orgB);
    const idA = await facture(orgA, "envoyee", "XT");
    const r = await request(appli(orgB)).post(`/api/factures-client/${idA}/transmettre`);
    expect(r.status).toBe(404);
    expect(pa.depots).toEqual([]);
  });

  it("le depot est conforme a la specification officielle", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "OK");
    const r = await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    expect(r.status).toBe(202);
    expect(pa.depots.length).toBe(1);
    const { flowInfo, fichier, typeFichier } = pa.depots[0]!;

    // Champs obligatoires de CoreFlowInfo, lus dans la spec.
    for (const champ of S.CoreFlowInfo.required as string[]) expect(flowInfo, `champ ${champ}`).toHaveProperty(champ);
    // Valeurs dans les enumerations de la spec.
    expect(ENUM("FlowSyntax")).toContain(flowInfo.flowSyntax);
    expect(ENUM("FlowProfile")).toContain(flowInfo.flowProfile);
    expect(ENUM("ProcessingRule")).toContain(flowInfo.processingRule);
    // Bornes de la spec.
    expect(String(flowInfo.name).length).toBeLessThanOrEqual(S.CoreFlowInfo.properties.name.maxLength);
    expect(String(flowInfo.trackingId).length).toBeLessThanOrEqual(S.NotOnlyUuid.maxLength);
    expect(String(flowInfo.sha256)).toMatch(new RegExp(S.FlowInfoExtension.properties.sha256.pattern));
    // L'empreinte est celle du fichier reellement envoye.
    expect(flowInfo.sha256).toBe(createHash("sha256").update(fichier).digest("hex"));
    // Le fichier est un PDF, du type annonce par la spec.
    expect(fichier.subarray(0, 5).toString()).toBe("%PDF-");
    expect(SPEC.components.requestBodies.FlowPostRequest.content["multipart/form-data"].encoding.file.contentType).toContain(typeFichier);
  });

  it("le PDF transmis porte le XML Factur-X", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "FX");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    expect(pa.depots[0]!.fichier.toString("latin1")).toMatch(/factur-x\.xml/i);
  });

  it("le flux et l'accuse sont enregistres sur la facture", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "EN");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    const f = await ligne(id);
    expect(f.paFlowId).toMatch(/^flux-/);
    expect(f.paStatut).toBe("Pending");
    expect(f.paTransmiseLe).toBeInstanceOf(Date);
  });

  it("une facture deja transmise ne part pas une seconde fois", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "DB");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    const r = await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    expect(r.status).toBe(409);
    expect(pa.depots.length).toBe(1);
  });

  it("une facture rejetee peut etre redeposee", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "RJ");
    await db.update(facturesClientTable).set({ paFlowId: "ancien", paStatut: "Error" }).where(eq(facturesClientTable.id, id));
    const r = await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    expect(r.status).toBe(202);
  });

  it("un refus de la plateforme est dit, et rien n'est enregistre", async () => {
    await raccorder(orgA);
    pa.statutDepot = 422;
    const id = await facture(orgA, "envoyee", "RF");
    const r = await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/rejete/);
    expect((await ligne(id)).paFlowId).toBeNull();
  });

  it("le jeton est reutilise tant qu'il est valide", async () => {
    await raccorder(orgA);
    const avant = pa.jetonsDelivres;
    await request(appli(orgA)).post(`/api/factures-client/${await facture(orgA, "envoyee", "J1")}/transmettre`);
    await request(appli(orgA)).post(`/api/factures-client/${await facture(orgA, "envoyee", "J2")}/transmettre`);
    expect(pa.jetonsDelivres - avant).toBe(1);
  });
});

// ── Suivi et reception ──────────────────────────────────────────────────────
describe("suivi des accuses et factures recues", () => {
  it("la recherche est conforme a la specification", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "RS");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    await request(appli(orgA)).post("/api/plateforme-agreee/suivi");
    const corps = pa.recherches.at(-1)!;
    for (const champ of S.SearchFlowParams.required as string[]) expect(corps).toHaveProperty(champ);
    const where = corps.where as Record<string, unknown>;
    for (const d of where.flowDirection as string[]) expect(ENUM("FlowDirection")).toContain(d);
    expect(Number(corps.limit)).toBeLessThanOrEqual(S.Limit.maximum);
  });

  it("un accuse Ok remplace Pending", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "AO");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    pa.accuseRecherche = "Ok";
    await request(appli(orgA)).post("/api/plateforme-agreee/suivi");
    expect((await ligne(id)).paStatut).toBe("Ok");
  });

  it("un rejet est enregistre avec son motif", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "AE");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    pa.accuseRecherche = "Error";
    await request(appli(orgA)).post("/api/plateforme-agreee/suivi");
    const f = await ligne(id);
    expect(f.paStatut).toBe("Error");
    expect(f.paDetail?.[0]?.reasonMessage).toBe("TVA acheteur invalide");
  });

  it("la tache periodique met les accuses a jour sans intervention", async () => {
    await raccorder(orgA);
    const id = await facture(orgA, "envoyee", "CR");
    await request(appli(orgA)).post(`/api/factures-client/${id}/transmettre`);
    pa.accuseRecherche = "Ok";
    await tickPlateformeAgreee();
    expect((await ligne(id)).paStatut).toBe("Ok");
  });

  it("les factures recues sont listees", async () => {
    await raccorder(orgA);
    pa.fluxRecus = [{ flowId: "in-1", name: "facture-fournisseur.pdf", submittedAt: "2026-09-20T10:00:00Z", flowSyntax: "Factur-X", flowDirection: "In", acknowledgement: { status: "Ok" } }];
    const r = await request(appli(orgA)).get("/api/plateforme-agreee/recues");
    expect(r.status).toBe(200);
    expect(r.body.factures).toEqual([expect.objectContaining({ flowId: "in-1", nom: "facture-fournisseur.pdf", statut: "Ok" })]);
    const where = pa.recherches.at(-1)!.where as Record<string, unknown>;
    expect(ENUM("FlowType")).toEqual(expect.arrayContaining(where.flowType as string[]));
  });
});

it("la fixture est bien la specification AFNOR 1.3.0", () => {
  // Si le fichier etait remplace par une copie maison, tout ce qui precede
  // redeviendrait une verification de nos propres suppositions.
  expect(SPEC.info.title).toBe("AFNOR Flow Service");
  expect(SPEC.info.version).toBe("1.3.0");
  expect(Object.keys(SPEC.paths)).toEqual(expect.arrayContaining(["/v1/flows", "/v1/flows/search", "/v1/healthcheck"]));
});

