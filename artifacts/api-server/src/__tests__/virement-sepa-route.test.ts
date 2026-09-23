/**
 * La remise de virements, depuis les depenses : la route, la vraie base.
 *
 * Le generateur est teste a part (virement-sepa.test.ts). Ce qui se joue ici
 * est le chemin : qui a le droit de produire une remise, ce qu'on refuse de
 * mettre dedans, et le fait qu'une remise ne PAIE rien — elle produit un
 * fichier que le responsable depose chez sa banque.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import { db, depensesTable, organisationsTable } from "@workspace/db";
import router from "../routes/depenses";

const parseur = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false });
const IBAN_ORG = "FR7630006000011234567890189";
const IBAN_FOURNISSEUR = "FR1420041010050500013M02606";
const IBAN_AUTRE = "DE89370400440532013000";

const stamp = Date.now();
let orgId = 0;
let orgSansIban = 0;

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

async function organisation(suffixe: string, iban: string | null): Promise<number> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Virements ${suffixe} ${stamp}`, slug: `vir-${suffixe}-${stamp}`,
    email: `vir-${suffixe}-${stamp}@example.test`, phone: "+33123456789",
    maxUsers: 5, actif: true, bankIban: iban, bankBic: iban ? "AGRIFRPP" : null,
  } as any).returning({ id: organisationsTable.id });
  return o!.id;
}

async function depense(options: Partial<{
  vendor: string; iban: string | null; bic: string | null; ttc: string;
  paiement: string; org: number; reference: string;
}> = {}): Promise<number> {
  const [d] = await db.insert(depensesTable).values({
    organisationId: options.org ?? orgId,
    vendor: options.vendor ?? "Materiaux du Sud",
    reference: options.reference ?? `F-${stamp}`,
    title: "Ciment",
    category: "materiel",
    amountHt: "100.00", amountTva: "20.00", amountTtc: options.ttc ?? "120.00",
    status: "approuve",
    paymentStatus: options.paiement ?? "a_payer",
    vendorIban: options.iban === undefined ? IBAN_FOURNISSEUR : options.iban,
    vendorBic: options.bic ?? null,
  } as any).returning({ id: depensesTable.id });
  return d!.id;
}

const remise = (ids: number[], role = "administrateur", org = orgId, corps: Record<string, unknown> = {}) =>
  request(appli(role, org)).post("/api/depenses/virement-sepa").send({ ids, ...corps });

beforeAll(async () => {
  orgId = await organisation("a", IBAN_ORG);
  orgSansIban = await organisation("b", null);
}, 60_000);

afterAll(async () => {
  for (const o of [orgId, orgSansIban]) {
    await db.delete(depensesTable).where(eq(depensesTable.organisationId, o));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
  }
});

beforeEach(async () => {
  await db.delete(depensesTable).where(eq(depensesTable.organisationId, orgId));
  await db.delete(depensesTable).where(eq(depensesTable.organisationId, orgSansIban));
});

describe("le fichier remis", () => {
  it("contient les depenses demandees, avec leur montant TTC", async () => {
    const a = await depense({ ttc: "120.00", vendor: "Materiaux du Sud" });
    const b = await depense({ ttc: "80.50", vendor: "Sous-traitant Nord", iban: IBAN_AUTRE });
    const r = await remise([a, b]);
    expect(r.status, r.text.slice(0, 200)).toBe(200);
    expect(r.headers["content-type"]).toMatch(/xml/);
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="virements_\d{4}-\d{2}-\d{2}\.xml"/);

    const doc = parseur.parse(r.text).Document.CstmrCdtTrfInitn;
    expect(String(doc.GrpHdr.CtrlSum)).toBe("200.50");
    const tx = doc.PmtInf.CdtTrfTxInf;
    expect(tx).toHaveLength(2);
    expect(tx.map((t: any) => t.Cdtr.Nm).sort()).toEqual(["Materiaux du Sud", "Sous-traitant Nord"]);
  });

  it("porte l'IBAN de l'entreprise en donneur d'ordre", async () => {
    const id = await depense();
    const r = await remise([id]);
    const doc = parseur.parse(r.text).Document.CstmrCdtTrfInitn;
    expect(doc.PmtInf.DbtrAcct.Id.IBAN).toBe(IBAN_ORG);
    expect(doc.PmtInf.DbtrAgt.FinInstnId.BICFI).toBe("AGRIFRPP");
  });

  it("chaque ligne porte la reference de la depense, pour le rapprochement", async () => {
    const id = await depense();
    const r = await remise([id]);
    const tx = parseur.parse(r.text).Document.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf;
    expect(tx.PmtId.EndToEndId).toBe(`DEP-${id}`);
    expect(String(tx.RmtInf.Ustrd)).toContain("Ciment");
  });

  it("annonce le nombre et le total dans les en-tetes de la reponse", async () => {
    const id = await depense({ ttc: "42.10" });
    const r = await remise([id]);
    expect(r.headers["x-virements-nombre"]).toBe("1");
    expect(r.headers["x-virements-total"]).toBe("42.10");
  });

  it("la date d'execution demandee est reprise ; sinon c'est demain", async () => {
    const id = await depense();
    const choisie = await remise([id], "administrateur", orgId, { dateExecution: "2026-11-20" });
    expect(parseur.parse(choisie.text).Document.CstmrCdtTrfInitn.PmtInf.ReqdExctnDt.Dt).toBe("2026-11-20");

    // « Demain » se lit dans le fuseau de l'entreprise, pas en UTC : a 23h30 a
    // Paris, la date UTC est encore celle de la veille, et la remise partirait
    // avec une date d'execution deja passee — que la banque refuse.
    const parDefaut = await remise([id]);
    const demainParis = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(Date.now() + 86_400_000));
    expect(parseur.parse(parDefaut.text).Document.CstmrCdtTrfInitn.PmtInf.ReqdExctnDt.Dt).toBe(demainParis);
  });
});

describe("ce que la remise refuse", () => {
  it("une depense sans IBAN : elle dit laquelle", async () => {
    const bonne = await depense();
    const sans = await depense({ vendor: "Sans IBAN", iban: null });
    const r = await remise([bonne, sans]);
    expect(r.status).toBe(409);
    expect(r.body.depenses).toEqual([{ id: sans, fournisseur: "Sans IBAN" }]);
  });

  it("une depense deja payee : la remettre paierait deux fois", async () => {
    const payee = await depense({ vendor: "Deja payee", paiement: "paye" });
    const r = await remise([payee]);
    expect(r.status).toBe(409);
    expect(r.body.depenses).toEqual([{ id: payee, fournisseur: "Deja payee" }]);
  });

  it("sans IBAN d'entreprise, elle renvoie aux parametres au lieu de planter", async () => {
    const id = await depense({ org: orgSansIban });
    const r = await remise([id], "administrateur", orgSansIban);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/parametres/i);
  });

  it("une selection vide, ou demesuree", async () => {
    expect((await remise([])).status).toBe(400);
    expect((await remise(Array.from({ length: 501 }, (_, i) => i + 1))).status).toBe(400);
  });

  it("des identifiants inconnus ne produisent pas un fichier vide", async () => {
    const r = await remise([999_000_001, 999_000_002]);
    expect(r.status).toBe(404);
  });
});

describe("qui peut, et ce qui ne bouge pas", () => {
  it("un agent ne produit pas de remise : c'est un acte de direction", async () => {
    const id = await depense();
    expect((await remise([id], "agent")).status).toBe(403);
    expect((await remise([id], "lecture_seule")).status).toBe(403);
  });

  it("les depenses d'une autre organisation sont invisibles", async () => {
    const mienne = await depense();
    const autre = await depense({ org: orgSansIban, vendor: "Chez le voisin" });
    const r = await remise([mienne, autre]);
    expect(r.status).toBe(200);
    // Une seule ligne : celle de l'organisation appelante.
    const tx = parseur.parse(r.text).Document.CstmrCdtTrfInitn.PmtInf.CdtTrfTxInf;
    expect(Array.isArray(tx)).toBe(false);
    expect(tx.PmtId.EndToEndId).toBe(`DEP-${mienne}`);
  });

  it("produire la remise ne marque RIEN comme paye", async () => {
    // Le fichier peut ne jamais etre depose : marquer « paye » ici afficherait
    // un paiement qui n'a pas eu lieu. C'est le releve qui tranchera.
    const id = await depense();
    expect((await remise([id])).status).toBe(200);
    const [apres] = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(apres!.paymentStatus).toBe("a_payer");
  });
});

describe("la saisie des coordonnees bancaires", () => {
  const modifier = (id: number, corps: Record<string, unknown>) =>
    request(appli()).patch(`/api/depenses/${id}`).send(corps);

  it("un IBAN valide est enregistre en forme normalisee", async () => {
    const id = await depense({ iban: null });
    const r = await modifier(id, { vendorIban: " fr14 2004 1010 0505 0001 3M02 606 " });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [apres] = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(apres!.vendorIban).toBe(IBAN_FOURNISSEUR);
  });

  it("un IBAN faux est refuse a la saisie, et designe son champ", async () => {
    const id = await depense({ iban: null });
    const r = await modifier(id, { vendorIban: "FR7630006000011234567890188" });
    expect(r.status).toBe(400);
    expect(r.body.issues?.[0]?.path).toBe("vendorIban");
    const [apres] = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(apres!.vendorIban).toBeNull();
  });

  it("un BIC faux est refuse ; un BIC juste est mis en majuscules", async () => {
    const id = await depense();
    expect((await modifier(id, { vendorBic: "FR76" })).status).toBe(400);
    expect((await modifier(id, { vendorBic: "agrifrpp" })).status).toBe(200);
    const [apres] = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(apres!.vendorBic).toBe("AGRIFRPP");
  });

  it("vider le champ est permis : toutes les depenses ne se paient pas par virement", async () => {
    const id = await depense();
    expect((await modifier(id, { vendorIban: "" })).status).toBe(200);
    const [apres] = await db.select().from(depensesTable).where(eq(depensesTable.id, id));
    expect(apres!.vendorIban).toBeNull();
  });
});
