/**
 * Une URL controlee ne doit pas rediriger vers une adresse qui ne l'est pas.
 *
 * La garde anti-SSRF valide l'URL fournie par le client. Mais `fetch` suit
 * les redirections par defaut : un recepteur de webhook ou une « plateforme »
 * malveillants repondant 307 vers http://169.254.169.254/... faisaient partir
 * la requete — POST, corps signe et jeton d'acces compris — vers une adresse
 * jamais controlee. (Signalement de la session Kaverd, 22/09/2026.)
 *
 * Ni un webhook ni l'API AFNOR n'ont a rediriger : la redirection est refusee
 * et devient un echec nomme.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { ErreurPA, deposerFacture, obtenirJeton, oublierJeton, type RaccordementPA } from "../services/plateforme-agreee";

/** Ce que la cible « interne » a recu : rien, si les redirections sont refusees. */
let recuParLaCible: string[] = [];
let cible: Server;
let piege: Server;
let urlCible = "";
let urlPiege = "";

function ecouter(app: express.Express): Promise<[Server, string]> {
  return new Promise((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok([s, `http://127.0.0.1:${(s.address() as AddressInfo).port}`]));
  });
}

beforeAll(async () => {
  const c = express();
  c.use(express.raw({ type: "*/*" }), (req, res) => { recuParLaCible.push(`${req.method} ${req.url}`); res.json({ access_token: "vole", flowId: "vole" }); });
  [cible, urlCible] = await ecouter(c);
  // Le « piege » renvoie TOUT vers la cible, en 307 (qui conserve methode et corps).
  const p = express();
  p.use((req, res) => { res.redirect(307, `${urlCible}${req.url}`); });
  [piege, urlPiege] = await ecouter(p);
});
afterAll(() => { cible?.close(); piege?.close(); });
beforeEach(() => { recuParLaCible = []; });

const raccordement = (): RaccordementPA => ({
  organisationId: 999_001, urlFlow: `${urlPiege}/afnor-flow`, urlJeton: `${urlPiege}/oauth2/token`,
  clientId: "c", clientSecret: "secret-a-ne-pas-livrer",
});

describe("plateforme agreee : aucune redirection suivie", () => {
  it("le jeton : une redirection est un refus, pas un detour", async () => {
    const r = raccordement();
    oublierJeton(r);
    await expect(obtenirJeton(r)).rejects.toBeInstanceOf(ErreurPA);
    expect(recuParLaCible, "les identifiants sont partis vers la cible de la redirection").toEqual([]);
  });

  it("le depot : la facture ne part pas vers la cible de la redirection", async () => {
    // Jeton obtenu d'une vraie « plateforme » (la cible elle-meme) pour
    // atteindre l'etape du depot, qui, elle, redirige.
    const r = { ...raccordement(), urlJeton: `${urlCible}/oauth2/token`, organisationId: 999_002 };
    oublierJeton(r);
    await obtenirJeton(r);
    recuParLaCible = [];
    await expect(deposerFacture(r, Buffer.from("%PDF-1.7 test"), "f.pdf", "t-1")).rejects.toBeInstanceOf(ErreurPA);
    expect(recuParLaCible).toEqual([]);
  });

  it("le refus dit ce qui s'est passe, sans le corps de la reponse", async () => {
    const r = { ...raccordement(), organisationId: 999_003 };
    oublierJeton(r);
    let e: ErreurPA | undefined;
    try { await obtenirJeton(r); } catch (x) { e = x as ErreurPA; }
    if (!e) throw new Error("le jeton aurait du etre refuse");
    expect(e.messagePublic).toMatch(/HTTP 307/);
    expect(e.messagePublic).not.toContain("secret");
  });
});

describe("les trois appels vers une URL fournie par le client refusent les redirections", () => {
  const SRC = (...p: string[]) => readFileSync(join(import.meta.dirname, "..", ...p), "utf8");

  it("livraison de webhook", () => {
    const s = SRC("services", "webhook-service.ts");
    const i = s.indexOf("const res = await fetch(endpoint.url");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, s.indexOf("});", i))).toContain('redirect: "manual"');
  });

  it("une redirection de webhook est un echec nomme", () => {
    expect(SRC("services", "webhook-service.ts")).toMatch(/redirection refusee \(HTTP \$\{res\.status\}\)/);
  });

  it("plateforme agreee : jeton et API", () => {
    const s = SRC("services", "plateforme-agreee.ts");
    expect((s.match(/redirect: "manual"/g) ?? []).length).toBe(2);
    expect((s.match(/await fetch\(/g) ?? []).length).toBe(2);
  });

  it("recherche web : deja manuelle (l'en-tete Location est lu, pas suivi)", () => {
    expect(SRC("services", "web-search.ts")).toMatch(/redirect: "manual"/);
  });
});
