/**
 * Depot des factures du secteur public sur Chorus Pro.
 *
 * Une facture adressee a une commune, a un hopital ou a un office HLM ne se
 * transmet pas par la plateforme agreee : elle se depose sur Chorus Pro. Sans
 * ce chemin, une entreprise du batiment qui travaille pour la commande
 * publique n'est pas payee — et le produit ne le disait nulle part.
 *
 * Un faux Chorus Pro tourne en local (PISTE compris) ; les routes sont les
 * vraies, la base aussi. Ce qui est verifie ici est ce que le SERVEUR DISTANT
 * recoit : en-tetes, corps, et ce que le produit en fait.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable, raccordementsChorusProTable } from "@workspace/db";
import router from "../routes/chorus-pro";
import { encryptSensitiveData } from "../lib/crypto";
import {
  CHEMIN_COMPTE_RENDU, CHEMIN_DEPOT, CHEMIN_STRUCTURES,
  enteteCompte, oublierJetonChorus,
} from "../services/chorus-pro";

const COMPTE = "TECH_TEST@cpro.fr";
const MOT_DE_PASSE = "mot-de-passe-technique";
const SECRET_PISTE = "secret-piste-de-test";
const SYNTAXE = "IN_DP_E2_CII_FACTURX";

// ── Le faux Chorus Pro (PISTE + API) ────────────────────────────────────────
const cpro = {
  jetonsDelivres: 0,
  depots: [] as Array<{ corps: any; entetes: Record<string, string> }>,
  comptesRendus: [] as any[],
  structures: [] as any[],
  codeRetourDepot: 0,
  statutDepot: 200,
  etatCourant: "INTEGRE",
};
let serveur: Server;
let url = "";

function demarrer(): Promise<void> {
  const app = express();
  app.post("/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    if (req.body.grant_type !== "client_credentials" || req.body.client_secret !== SECRET_PISTE) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    cpro.jetonsDelivres++;
    res.json({ access_token: `jeton-${cpro.jetonsDelivres}`, token_type: "Bearer", expires_in: 3600 });
  });
  const auth = (req: Request, res: Response, next: NextFunction) => {
    if (!String(req.headers.authorization ?? "").startsWith("Bearer jeton-")) { res.status(401).end(); return; }
    next();
  };
  app.post(`/cpro${CHEMIN_DEPOT}`, auth, express.json({ limit: "20mb" }), (req, res) => {
    cpro.depots.push({ corps: req.body, entetes: req.headers as Record<string, string> });
    if (cpro.statutDepot !== 200) {
      // Une passerelle bavarde renvoie ce qu-elle a recu. C-est precisement
      // pourquoi le corps d-une reponse d-erreur ne doit jamais remonter a
      // l-ecran : il porte ici le compte technique et son mot de passe.
      res.status(cpro.statutDepot).json({ message: "refus", recu: { compte: Buffer.from(String(req.headers["cpro-account"] ?? ""), "base64").toString("utf8") } });
      return;
    }
    res.json({
      codeRetour: cpro.codeRetourDepot,
      libelle: cpro.codeRetourDepot === 0 ? "Depot accepte" : "Format non reconnu",
      numeroFluxDepot: cpro.codeRetourDepot === 0 ? `FLUX-${cpro.depots.length}` : null,
    });
  });
  app.post(`/cpro${CHEMIN_COMPTE_RENDU}`, auth, express.json(), (req, res) => {
    cpro.comptesRendus.push(req.body);
    res.json({ numeroFluxDepot: req.body.numeroFluxDepot, etatCourantFlux: cpro.etatCourant, nomFichierFlux: "f.pdf" });
  });
  app.post(`/cpro${CHEMIN_STRUCTURES}`, auth, express.json(), (req, res) => {
    cpro.structures.push(req.body);
    res.json({ codeRetour: 0, listeStructures: [{ idStructureCPP: 42, identifiantStructure: req.body?.structure?.identifiantStructure }] });
  });
  return new Promise((ok) => {
    serveur = app.listen(0, "127.0.0.1", () => {
      url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
      ok();
    });
  });
}

// ── L'application ───────────────────────────────────────────────────────────
const stamp = Date.now();
let orgId = 0;

function appli(role = "administrateur", org = orgId) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId: 1, organisationId: org, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

async function facture(status: string, ref: string): Promise<number> {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `${ref}-${stamp}`, title: "Travaux", clientName: "Commune de Test",
    clientSiren: "552100554", items: [{ description: "Pose", quantity: 1, unitPrice: 100, vatRate: 20 }] as any,
    subtotal: "100", taxAmount: "20", totalAmount: "100", status,
  }).returning({ id: facturesClientTable.id });
  return f!.id;
}

const raccordementTest = () => ({
  organisationId: orgId, urlJeton: `${url}/oauth/token`, clientId: "client-piste",
  urlBase: `${url}/cpro`, clientSecret: SECRET_PISTE,
  compteTechnique: COMPTE, motDePasseTechnique: MOT_DE_PASSE, syntaxeFlux: SYNTAXE,
});

async function raccorder(options: Partial<{ idUtilisateurCourant: number }> = {}) {
  await db.delete(raccordementsChorusProTable).where(eq(raccordementsChorusProTable.organisationId, orgId));
  // Insere directement : la route refuse (a juste titre) une adresse locale.
  await db.insert(raccordementsChorusProTable).values({
    organisationId: orgId, urlBase: `${url}/cpro`, urlJeton: `${url}/oauth/token`,
    clientId: "client-piste", clientSecretChiffre: encryptSensitiveData(SECRET_PISTE),
    compteTechnique: COMPTE, motDePasseTechniqueChiffre: encryptSensitiveData(MOT_DE_PASSE),
    syntaxeFlux: SYNTAXE, idUtilisateurCourant: options.idUtilisateurCourant ?? null,
  });
  oublierJetonChorus(raccordementTest());
}

const ligne = async (id: number) => (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0]!;

beforeAll(async () => {
  await demarrer();
  const [o] = await db.insert(organisationsTable).values({
    name: `Chorus ${stamp}`, slug: `chorus-${stamp}`, email: `chorus-${stamp}@example.test`,
    phone: "+33123456789", maxUsers: 5, actif: true, siret: "89097764800017",
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
}, 60_000);

afterAll(async () => {
  serveur?.close();
  await db.delete(raccordementsChorusProTable).where(eq(raccordementsChorusProTable.organisationId, orgId));
  await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
  await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});

beforeEach(async () => {
  cpro.depots = []; cpro.comptesRendus = []; cpro.structures = [];
  cpro.codeRetourDepot = 0; cpro.statutDepot = 200; cpro.etatCourant = "INTEGRE";
  await raccorder();
});

describe("ce que Chorus Pro recoit", () => {
  it("le fichier depose est le Factur-X, encode en base64", async () => {
    const id = await facture("sent", "CH-1");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const depot = cpro.depots[0]!;
    const fichier = Buffer.from(depot.corps.fichierFlux, "base64");
    // Un PDF/A-3 : c'est le meme document que celui remis au client.
    expect(fichier.subarray(0, 5).toString()).toBe("%PDF-");
    expect(fichier.length).toBeGreaterThan(1000);
  });

  it("le compte technique voyage dans l'en-tete cpro-account, encode en base64", async () => {
    const id = await facture("sent", "CH-2");
    await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    const recu = cpro.depots[0]!.entetes["cpro-account"];
    expect(Buffer.from(recu, "base64").toString("utf8")).toBe(`${COMPTE}:${MOT_DE_PASSE}`);
    expect(recu).toBe(enteteCompte(raccordementTest()));
  });

  it("la syntaxe declaree est celle du raccordement, jamais une valeur ecrite en dur", async () => {
    await db.update(raccordementsChorusProTable).set({ syntaxeFlux: "IN_DP_E1_UBL_INVOICE" })
      .where(eq(raccordementsChorusProTable.organisationId, orgId));
    const id = await facture("sent", "CH-3");
    await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(cpro.depots[0]!.corps.syntaxeFlux).toBe("IN_DP_E1_UBL_INVOICE");
  });

  it("l'identifiant d'utilisateur n'est envoye que s'il est renseigne", async () => {
    const id = await facture("sent", "CH-4");
    await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(cpro.depots[0]!.corps).not.toHaveProperty("idUtilisateurCourant");

    await raccorder({ idUtilisateurCourant: 777 });
    const id2 = await facture("sent", "CH-5");
    await request(appli()).post(`/api/factures-client/${id2}/chorus`).send({});
    expect(cpro.depots[1]!.corps.idUtilisateurCourant).toBe(777);
  });

  it("le jeton PISTE est demande une fois et reutilise", async () => {
    const avant = cpro.jetonsDelivres;
    const a = await facture("sent", "CH-6");
    const b = await facture("sent", "CH-7");
    await request(appli()).post(`/api/factures-client/${a}/chorus`).send({});
    await request(appli()).post(`/api/factures-client/${b}/chorus`).send({});
    expect(cpro.jetonsDelivres - avant).toBe(1);
  });
});

describe("ce que le produit en retient", () => {
  it("le numero de flux est enregistre sur la facture", async () => {
    const id = await facture("sent", "CH-8");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.body.numeroFluxDepot).toMatch(/^FLUX-/);
    const f = await ligne(id);
    expect(f.chorusNumeroFlux).toBe(r.body.numeroFluxDepot);
    expect(f.chorusEtat).toBe("DEPOSE");
    expect(f.chorusDeposeeLe).toBeInstanceOf(Date);
  });

  it("un refus METIER (codeRetour non nul, HTTP 200) n'est pas un succes", async () => {
    // Chorus Pro repond 200 en refusant : le confondre avec un succes
    // afficherait « deposee » pour une facture que personne n'a recue.
    cpro.codeRetourDepot = 12;
    const id = await facture("sent", "CH-9");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status).toBe(502);
    expect((await ligne(id)).chorusNumeroFlux).toBeNull();
  });

  it("un refus HTTP ne laisse ni numero ni date sur la facture", async () => {
    cpro.statutDepot = 403;
    const id = await facture("sent", "CH-10");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/compte technique|acces/i);
    const f = await ligne(id);
    expect(f.chorusNumeroFlux).toBeNull();
    expect(f.chorusDeposeeLe).toBeNull();
  });

  it("le message d'erreur ne contient aucun secret", async () => {
    cpro.statutDepot = 500;
    const id = await facture("sent", "CH-11");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    const texte = JSON.stringify(r.body);
    for (const secret of [SECRET_PISTE, MOT_DE_PASSE, COMPTE]) expect(texte).not.toContain(secret);
  });

  it("le suivi met a jour l'etat depuis le compte rendu", async () => {
    const id = await facture("sent", "CH-12");
    await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    cpro.etatCourant = "REJETE";
    const r = await request(appli()).post("/api/chorus-pro/suivi").send({});
    expect(r.status).toBe(200);
    expect(r.body.misesAJour).toBeGreaterThanOrEqual(1);
    expect((await ligne(id)).chorusEtat).toBe("REJETE");
    // Le compte rendu est demande avec le numero rendu au depot.
    expect(cpro.comptesRendus[0]!.numeroFluxDepot).toMatch(/^FLUX-/);
  });

  it("une facture deja integree n'est plus redemandee", async () => {
    const id = await facture("sent", "CH-13");
    await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    await request(appli()).post("/api/chorus-pro/suivi").send({}); // -> INTEGRE
    cpro.comptesRendus = [];
    await request(appli()).post("/api/chorus-pro/suivi").send({});
    expect(cpro.comptesRendus).toEqual([]);
  });
});

describe("ce que le produit refuse", () => {
  it("un brouillon ne part pas : son numero peut encore changer", async () => {
    const id = await facture("brouillon", "CH-14");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status).toBe(409);
    expect(cpro.depots).toEqual([]);
  });

  it("un second depot de la meme facture est refuse", async () => {
    const id = await facture("sent", "CH-15");
    expect((await request(appli()).post(`/api/factures-client/${id}/chorus`).send({})).status).toBe(202);
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status).toBe(409);
    expect(cpro.depots).toHaveLength(1);
  });

  it("une facture rejetee, elle, peut etre redeposee apres correction", async () => {
    const id = await facture("sent", "CH-16");
    await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    await db.update(facturesClientTable).set({ chorusEtat: "REJETE" }).where(eq(facturesClientTable.id, id));
    expect((await request(appli()).post(`/api/factures-client/${id}/chorus`).send({})).status).toBe(202);
  });

  it("sans raccordement, le depot dit quoi faire au lieu de planter", async () => {
    await db.delete(raccordementsChorusProTable).where(eq(raccordementsChorusProTable.organisationId, orgId));
    const id = await facture("sent", "CH-17");
    const r = await request(appli()).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/parametres/i);
  });

  it("un simple utilisateur ne depose pas et ne lit pas le raccordement", async () => {
    const id = await facture("sent", "CH-18");
    expect((await request(appli("utilisateur")).post(`/api/factures-client/${id}/chorus`).send({})).status).toBe(403);
    expect((await request(appli("utilisateur")).get("/api/chorus-pro")).status).toBe(403);
    expect(cpro.depots).toEqual([]);
  });

  it("la facture d'une AUTRE organisation est introuvable, pas deposable", async () => {
    const id = await facture("sent", "CH-19");
    const r = await request(appli("administrateur", orgId + 1_000_000)).post(`/api/factures-client/${id}/chorus`).send({});
    expect(r.status).not.toBe(202);
    expect(cpro.depots).toEqual([]);
  });
});

describe("le raccordement lui-meme", () => {
  it("ne rend jamais les secrets, seulement leur presence", async () => {
    const r = await request(appli()).get("/api/chorus-pro");
    expect(r.status).toBe(200);
    expect(r.body.configure).toBe(true);
    expect(r.body.secretEnregistre).toBe(true);
    expect(r.body.motDePasseEnregistre).toBe(true);
    const texte = JSON.stringify(r.body);
    expect(texte).not.toContain(SECRET_PISTE);
    expect(texte).not.toContain(MOT_DE_PASSE);
  });

  it("refuse une adresse qui n'est pas une URL https publique", async () => {
    const r = await request(appli()).put("/api/chorus-pro").send({
      urlBase: "http://127.0.0.1:9/cpro", urlJeton: "http://127.0.0.1:9/oauth/token",
      clientId: "c", clientSecret: "s", compteTechnique: COMPTE, motDePasseTechnique: "m", syntaxeFlux: SYNTAXE,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/https/i);
  });

  it("le test du raccordement n'envoie aucune facture", async () => {
    const r = await request(appli()).post("/api/chorus-pro/test").send({});
    expect(r.status).toBe(200);
    expect(r.body.jeton).toBe(true);
    expect(cpro.depots).toEqual([]);
  });

  it("la recherche de structure exige un SIRET a quatorze chiffres", async () => {
    const mauvais = await request(appli()).post("/api/chorus-pro/structure").send({ siret: "123" });
    expect(mauvais.status).toBe(502);
    expect(cpro.structures).toEqual([]);
    const bon = await request(appli()).post("/api/chorus-pro/structure").send({ siret: "130 025 265 00013" });
    expect(bon.status).toBe(200);
    expect(cpro.structures[0]!.structure.identifiantStructure).toBe("13002526500013");
  });
});
