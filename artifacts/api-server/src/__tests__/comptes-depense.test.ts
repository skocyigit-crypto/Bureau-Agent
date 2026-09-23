/**
 * Le compte comptable d'une categorie de depense.
 *
 * Le registre remis au comptable portait « sous_traitance » ou « carburant »,
 * et le cabinet refaisait le rapprochement vers le plan comptable a la main.
 * Il porte desormais le compte — celui que le CLIENT a choisi, car le compte
 * juste depend du cabinet et du marche.
 *
 * Ce qui est verifie ici : les regles qui empechent d'ecrire n'importe quoi
 * (une depense est une charge, la classe ne se saisit pas), le fait que le
 * plan propose ne s'applique pas tout seul, et la colonne dans l'export.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, comptesDepenseTable, depensesTable, organisationsTable } from "@workspace/db";
import router from "../routes/depenses";
import {
  ErreurCompte, PLAN_PROPOSE_BTP, classeDuCompte, compteValide, normaliserCompte, validerLigne,
} from "../services/comptes-depense";

const stamp = Date.now();
let orgId = 0;
let orgVoisine = 0;

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

async function organisation(suffixe: string): Promise<number> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Comptes ${suffixe} ${stamp}`, slug: `comptes-${suffixe}-${stamp}`,
    email: `comptes-${suffixe}-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true,
  } as any).returning({ id: organisationsTable.id });
  return o!.id;
}

beforeAll(async () => {
  orgId = await organisation("a");
  orgVoisine = await organisation("b");
}, 60_000);

afterAll(async () => {
  for (const o of [orgId, orgVoisine]) {
    await db.delete(comptesDepenseTable).where(eq(comptesDepenseTable.organisationId, o));
    await db.delete(depensesTable).where(eq(depensesTable.organisationId, o));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
  }
});

beforeEach(async () => {
  await db.delete(comptesDepenseTable).where(eq(comptesDepenseTable.organisationId, orgId));
  await db.delete(comptesDepenseTable).where(eq(comptesDepenseTable.organisationId, orgVoisine));
});

describe("la classe se deduit, elle ne se saisit pas", () => {
  it("elle est le premier chiffre du numero", () => {
    expect(classeDuCompte("604000")).toBe(6);
    expect(classeDuCompte("445660")).toBe(4);
    expect(classeDuCompte("706")).toBe(7);
  });

  it("une depense rangee en classe 7 est refusee", () => {
    // Un achat compte en produit ne fausse pas une ligne : il gonfle le
    // RESULTAT, et l'ecart ne se voit qu'a l'arrete des comptes.
    let e: unknown;
    try { validerLigne({ categorie: "materiel", compteCharge: "706000" }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(ErreurCompte);
    expect((e as ErreurCompte).messagePublic).toMatch(/classe 6/);
    expect((e as ErreurCompte).champ).toBe("compteCharge");
  });

  it("un compte de TVA hors classe 4 est refuse", () => {
    let e: unknown;
    try { validerLigne({ categorie: "materiel", compteCharge: "605000", compteTva: "605000" }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(ErreurCompte);
    expect((e as ErreurCompte).champ).toBe("compteTva");
  });

  it("un numero trop court, trop long ou non numerique est refuse", () => {
    for (const mauvais of ["", "60", "6040001234567", "604-000", "abc"]) {
      expect(compteValide(mauvais), mauvais).toBe(false);
    }
    expect(compteValide("604")).toBe(true);
    expect(compteValide("604000")).toBe(true);
  });

  it("les espaces sont ignores, les zeros de tete conserves", () => {
    // Un numero est une chaine : 0604 n'est pas 604, et un entier perdrait le
    // zero au premier aller-retour JSON.
    expect(normaliserCompte(" 604 000 ")).toBe("604000");
    expect(validerLigne({ categorie: "materiel", compteCharge: "605000", compteTva: "445 660" }).compteTva).toBe("445660");
  });

  it("une categorie inconnue est refusee", () => {
    let e: unknown;
    try { validerLigne({ categorie: "cheval", compteCharge: "604000" }); } catch (x) { e = x; }
    expect((e as ErreurCompte).champ).toBe("categorie");
  });
});

describe("le plan propose", () => {
  it("couvre toutes les categories du produit", async () => {
    const { EXPENSE_CATEGORIES } = await import("@workspace/db");
    const proposees = new Set(PLAN_PROPOSE_BTP.map(([c]) => c));
    for (const c of EXPENSE_CATEGORIES) expect(proposees.has(c), `categorie sans proposition : ${c}`).toBe(true);
  });

  it("ne propose que des charges, et des comptes de tiers pour la TVA", () => {
    for (const [categorie, charge, tva] of PLAN_PROPOSE_BTP) {
      expect(classeDuCompte(charge), `${categorie} -> ${charge}`).toBe(6);
      if (tva) expect(classeDuCompte(tva), `${categorie} -> TVA ${tva}`).toBe(4);
    }
  });

  it("n'est PAS applique tout seul : la table reste vide tant qu'on n'a rien choisi", async () => {
    const r = await request(appli()).get("/api/depenses/comptes");
    expect(r.status).toBe(200);
    expect(r.body.comptes).toEqual([]);
    expect(r.body.propose.length).toBe(PLAN_PROPOSE_BTP.length);
  });
});

describe("enregistrer son plan", () => {
  const enregistrer = (comptes: unknown[], role = "administrateur", org = orgId) =>
    request(appli(role, org)).put("/api/depenses/comptes").send({ comptes });

  it("enregistre ce qui est envoye, et le relit", async () => {
    const r = await enregistrer([
      { categorie: "sous_traitance", compteCharge: "611000", compteTva: "445660" },
      { categorie: "carburant", compteCharge: "606150" },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lu = await request(appli()).get("/api/depenses/comptes");
    const parCategorie = Object.fromEntries(lu.body.comptes.map((c: any) => [c.categorie, c]));
    expect(parCategorie.sous_traitance.compteCharge).toBe("611000");
    expect(parCategorie.carburant.compteTva).toBeNull();
  });

  it("modifier une categorie ne touche pas aux autres", async () => {
    await enregistrer([
      { categorie: "materiel", compteCharge: "605000" },
      { categorie: "honoraires", compteCharge: "622600" },
    ]);
    await enregistrer([{ categorie: "materiel", compteCharge: "606300" }]);
    const lu = await request(appli()).get("/api/depenses/comptes");
    const parCategorie = Object.fromEntries(lu.body.comptes.map((c: any) => [c.categorie, c.compteCharge]));
    expect(parCategorie.materiel).toBe("606300");
    expect(parCategorie.honoraires, "l'autre ligne a ete effacee").toBe("622600");
  });

  it("une categorie citee deux fois est refusee", async () => {
    const r = await enregistrer([
      { categorie: "materiel", compteCharge: "605000" },
      { categorie: "materiel", compteCharge: "606300" },
    ]);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/deux fois/);
  });

  it("un refus designe le champ fautif", async () => {
    const r = await enregistrer([{ categorie: "materiel", compteCharge: "706000" }]);
    expect(r.status).toBe(400);
    expect(r.body.issues?.[0]?.path).toBe("compteCharge");
  });

  it("le plan d'une organisation n'est pas visible par une autre", async () => {
    await enregistrer([{ categorie: "materiel", compteCharge: "605000" }]);
    const voisine = await request(appli("administrateur", orgVoisine)).get("/api/depenses/comptes");
    expect(voisine.body.comptes).toEqual([]);
  });

  it("un agent ne modifie pas le plan comptable", async () => {
    expect((await enregistrer([{ categorie: "materiel", compteCharge: "605000" }], "agent")).status).toBe(403);
    expect((await request(appli("agent")).get("/api/depenses/comptes")).status).toBe(403);
  });

  it("retirer une ligne la retire vraiment", async () => {
    await enregistrer([{ categorie: "loyer", compteCharge: "613200" }]);
    expect((await request(appli()).delete("/api/depenses/comptes/loyer")).status).toBe(200);
    expect((await request(appli()).delete("/api/depenses/comptes/loyer")).status).toBe(404);
    const lu = await request(appli()).get("/api/depenses/comptes");
    expect(lu.body.comptes).toEqual([]);
  });
});

describe("le registre remis au comptable", () => {
  async function depense(categorie: string, reference: string) {
    await db.insert(depensesTable).values({
      organisationId: orgId, vendor: "Fournisseur", reference, title: "Achat",
      category: categorie, amountHt: "100.00", amountTva: "20.00", amountTtc: "120.00",
      status: "approuve", paymentStatus: "a_payer",
    } as any);
  }

  it("porte le compte de chaque ligne quand il est renseigne", async () => {
    await depense("sous_traitance", `ST-${stamp}`);
    await request(appli()).put("/api/depenses/comptes").send({
      comptes: [{ categorie: "sous_traitance", compteCharge: "611000", compteTva: "445660" }],
    });
    const csv = await request(appli()).get("/api/depenses/export");
    expect(csv.status).toBe(200);
    const [entete, ...lignes] = csv.text.replace(/^﻿/, "").trim().split("\n");
    expect(entete).toContain("Compte");
    expect(entete).toContain("Compte TVA");
    const ligne = lignes.find((l) => l.includes(`ST-${stamp}`));
    expect(ligne, "depense absente de l'export").toBeTruthy();
    expect(ligne).toContain("611000");
    expect(ligne).toContain("445660");
  });

  it("laisse la colonne vide plutot que d'inventer un compte", async () => {
    // Une depense dont la categorie n'a pas de compte ne doit pas recevoir
    // celui d'une autre, ni un compte « par defaut » que personne n'a choisi.
    await depense("repas", `RE-${stamp}`);
    const csv = await request(appli()).get("/api/depenses/export");
    const ligne = csv.text.split("\n").find((l) => l.includes(`RE-${stamp}`))!;
    // Le format CSV entoure une cellule vide de guillemets : ce qui compte est
    // qu'aucun NUMERO n'y figure.
    const cellule = (i: number) => ligne.split(";")[i]!.replace(/^"|"$/g, "");
    expect(cellule(5), "un compte est apparu sans avoir ete choisi").toBe("");
    expect(cellule(6)).toBe("");
  });
});
