/**
 * Une depense saisie en TTC rangeait le TTC dans la colonne HT.
 *
 * Le calcul enchainait deux reconstructions qui se neutralisaient :
 *
 *     if (amountHt <= 0)  amountHt  = ttc - tva;   // tva = 0  =>  ht = ttc
 *     if (amountTva <= 0) amountTva = ttc - ht;    //           =>  tva = 0
 *
 * Saisir 120 EUR de materiaux — le cas le plus courant, un ticket qu'on
 * recopie — enregistrait 120 EUR de HT et 0 EUR de TVA. Deux torts dans le
 * meme sens : 20 EUR de TVA deductible jamais recuperes, et une charge
 * surevaluee d'autant, qui fausse le resultat et la marge du chantier.
 *
 * On ne devine pas de taux : en BTP ils coexistent (20 %, 10 % en renovation,
 * 5,5 % en renovation energetique). Choisir a la place de l'utilisateur
 * ecrirait une donnee fiscale inventee. Quand le taux manque, on le dit — a
 * la saisie par un refus explicite, a la lecture automatique par une mention
 * au dossier, puisque la personne n'est pas devant l'ecran.
 */
import { describe, expect, it } from "vitest";
import { montantsDepense, NOTE_TVA_NON_LUE, TAUX_TVA_CONNUS } from "../services/montants-depense";

describe("le defaut lui-meme", () => {
  it("un TTC seul n'est plus pris pour du HT en silence", () => {
    const m = montantsDepense({ ttc: 120 });
    expect(m.tvaInconnue, "c'est le silence qui faisait le defaut, pas le zero").toBe(true);
  });

  it("avec le taux, le HT est correct", () => {
    const m = montantsDepense({ ttc: 120, tauxTva: 20 });
    expect(m.ht).toBe(100);
    expect(m.tva).toBe(20);
    expect(m.tvaInconnue).toBe(false);
  });

  it("et la TVA deductible n'est plus perdue", () => {
    expect(montantsDepense({ ttc: 120, tauxTva: 20 }).tva).toBe(20);
  });
});

describe("les taux du BTP, qui ne sont pas tous a 20 %", () => {
  it("renovation a 10 %", () => {
    const m = montantsDepense({ ttc: 110, tauxTva: 10 });
    expect(m.ht).toBe(100);
    expect(m.tva).toBe(10);
  });

  it("renovation energetique a 5,5 %", () => {
    const m = montantsDepense({ ttc: 105.5, tauxTva: 5.5 });
    expect(m.ht).toBe(100);
    expect(m.tva).toBe(5.5);
  });

  it("les taux courants sont proposes a l'utilisateur", () => {
    expect(TAUX_TVA_CONNUS).toContain(10);
    expect(TAUX_TVA_CONNUS).toContain(5.5);
  });
});

describe("deux montants sur trois suffisent", () => {
  it("HT et TVA donnent le TTC", () => {
    expect(montantsDepense({ ht: 100, tva: 20 })).toMatchObject({ ht: 100, tva: 20, ttc: 120 });
  });

  it("TTC et HT donnent la TVA", () => {
    expect(montantsDepense({ ttc: 120, ht: 100 }).tva).toBe(20);
  });

  it("TTC et TVA donnent le HT", () => {
    expect(montantsDepense({ ttc: 120, tva: 20 }).ht).toBe(100);
  });

  it("un TTC contradictoire ne peut pas fausser HT et TVA deja connus", () => {
    // Deux montants coherents valent mieux qu'un troisieme qui les dement.
    expect(montantsDepense({ ht: 100, tva: 20, ttc: 999 }).ttc).toBe(120);
  });
});

describe("ce qui n'est pas un defaut", () => {
  it("un HT seul reste une saisie coherente", () => {
    // Assurance, salaires, operations hors champ: une charge sans TVA existe.
    const m = montantsDepense({ ht: 100 });
    expect(m).toMatchObject({ ht: 100, tva: 0, ttc: 100 });
    expect(m.tvaInconnue, "un HT declare n'est pas une ignorance").toBe(false);
  });

  it("un taux de 0 % est un taux, pas une absence", () => {
    expect(montantsDepense({ ttc: 100, tauxTva: 0 }).tvaInconnue).toBe(false);
  });
});

describe("les centimes, pas les flottants", () => {
  it("120 / 1,2 rend bien 100,00", () => {
    // En flottant, 120 / 1.2 = 99.99999999999999.
    expect(montantsDepense({ ttc: 120, tauxTva: 20 }).ht).toBe(100);
  });

  it("un montant a virgule se repartit sans reste perdu", () => {
    const m = montantsDepense({ ttc: 99.99, tauxTva: 20 });
    expect(Math.round((m.ht + m.tva) * 100)).toBe(9999);
  });
});

describe("ce que voit celui qui approuve", () => {
  it("la mention nomme ce qui manque et ce qu'il faut faire", () => {
    expect(NOTE_TVA_NON_LUE).toMatch(/TVA/);
    expect(NOTE_TVA_NON_LUE).toMatch(/completer/);
  });
});

// ---------------------------------------------------------------------------
// La regle ci-dessus ne vaut que si la ROUTE l'applique. Une fonction juste
// qu'aucune porte n'appelle ne corrige rien — c'est exactement le genre de
// controle qui reste vert pendant que le defaut reste en place.
// ---------------------------------------------------------------------------
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import { db, depensesTable, organisationsTable, usersTable } from "@workspace/db";
import depensesRouter from "../routes/depenses";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", depensesRouter);
  return a;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Depense ${stamp}`, slug: `depense-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `depense-${stamp}@example.test`,
    passwordHash: "x", prenom: "D", nom: "P", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("la porte de saisie applique bien la regle", () => {
  it("un TTC seul est accepte, mais l'ignorance est ecrite au dossier", async () => {
    // J'avais d'abord refuse ce cas en 400. Mesure faite: ce refus casse tous
    // les appelants qui n'envoient qu'un TTC, imports compris. Ce qu'on
    // corrige n'est pas le zero, c'est le SILENCE.
    const r = await supertest(appli()).post("/api/depenses")
      .send({ vendor: `Materiaux ${stamp}`, amountTtc: 120 });
    expect(r.status).toBe(201);
    const [d] = await db.select().from(depensesTable).where(eq(depensesTable.id, r.body.depense?.id ?? r.body.id));
    expect(d!.notes, "une TVA a zero non etablie doit se voir a l'approbation").toBe(NOTE_TVA_NON_LUE);
  });

  it("la mention ne remplace pas les notes de l'utilisateur", async () => {
    const r = await supertest(appli()).post("/api/depenses")
      .send({ vendor: `Materiaux ${stamp}`, amountTtc: 120, notes: "Chantier Dupont" });
    const [d] = await db.select().from(depensesTable).where(eq(depensesTable.id, r.body.depense?.id ?? r.body.id));
    expect(d!.notes).toContain("Chantier Dupont");
    expect(d!.notes).toContain("TVA");
  });

  it("avec le taux, la depense est enregistree en HT et TVA justes", async () => {
    const r = await supertest(appli()).post("/api/depenses")
      .send({ vendor: `Ciment ${stamp}`, amountTtc: 120, tauxTva: 20 });
    expect(r.status).toBe(201);
    const [d] = await db.select().from(depensesTable).where(eq(depensesTable.id, r.body.depense?.id ?? r.body.id));
    expect(Number(d!.amountHt)).toBe(100);
    expect(Number(d!.amountTva)).toBe(20);
    expect(Number(d!.amountTtc)).toBe(120);
  });

  it("et sans mention: rien n'est indetermine", async () => {
    const r = await supertest(appli()).post("/api/depenses")
      .send({ vendor: `Ciment ${stamp}`, amountTtc: 120, tauxTva: 20 });
    const [d] = await db.select().from(depensesTable).where(eq(depensesTable.id, r.body.depense?.id ?? r.body.id));
    expect(d!.notes ?? "").not.toContain("TVA non lue");
  });

  it("une saisie HT + TVA passe comme avant", async () => {
    const r = await supertest(appli()).post("/api/depenses")
      .send({ vendor: `Sable ${stamp}`, amountHt: 100, amountTva: 20 });
    expect(r.status, "le correctif ne doit fermer aucune saisie existante").toBe(201);
  });

  it("aucun montant reste refuse", async () => {
    const r = await supertest(appli()).post("/api/depenses").send({ vendor: `Rien ${stamp}` });
    expect(r.status).toBe(400);
  });
});
