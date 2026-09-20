/**
 * Un virement ne solde une facture que s'il la couvre.
 *
 * `apparier` rend une confiance de 100 des qu'une REFERENCE de facture figure
 * dans le libelle du virement — et c'est juste : une reference est unique par
 * construction, il n'y a rien a deviner sur le destinataire. Mais le MONTANT
 * n'entre pas dans cette branche, et le rapprochement automatique en tirait
 * pourtant `status: "payee"`.
 *
 * Un acompte de 10 EUR portant la reference en communication soldait donc une
 * facture de 588 EUR : la licence repartait, le solde n'etait plus jamais
 * reclame, et le client credite a tort ne dit rien. Le cas n'a rien de
 * theorique — la reference a mettre en communication est imprimee juste sous
 * l'IBAN dans le courriel de facture.
 *
 * La porte jumelle `/billing/payments/:id/assign` derive le statut de la somme
 * encaissee depuis toujours. Deux portes, deux regles, et c'est l'automatique
 * — celle que personne ne relit — qui avait la mauvaise.
 *
 * Ces controles passent par le VRAI routeur et la VRAIE base : c'est le statut
 * ECRIT qu'ils lisent, pas la forme du code.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, paymentsTable, usersTable } from "@workspace/db";
import router from "../routes/billing";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "super_admin" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", router);
  return a;
}

/** Une facture plateforme EMISE: 490 HT, 98 de TVA, 588 TTC. */
async function facture(ref: string) {
  const [f] = await db.insert(invoicesTable).values({
    organisationId: orgId,
    periodLabel: "2026-09",
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-30"),
    plan: "professionnel",
    baseAmount: "490.00",
    overageAmount: "0.00",
    totalAmount: "490.00",
    vatRate: "20.00",
    vatAmount: "98.00",
    totalTtc: "588.00",
    reference: ref,
    issuedAt: new Date(),
    status: "en_attente",
  } as any).returning();
  return f!;
}

/** Un virement recu, avec la reference en communication. */
async function virement(montant: string, libelle: string) {
  const [p] = await db.insert(paymentsTable).values({
    amount: montant,
    currency: "EUR",
    payerName: "Dupont SARL",
    rawLine: libelle,
    bankRef: `BK-${stamp}-${Math.floor(Math.random() * 1e6)}`,
    receivedAt: new Date(),
    status: "pending",
  } as any).returning();
  return p!;
}

const relire = async (id: number) =>
  (await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)))[0]!;

// La reference doit tenir en 30 caracteres (varchar) et faire au moins six
// signes, sinon `apparier` la refuse: « FAC1 » matcherait par hasard dans un
// IBAN.
let compteur = 0;
const base = String(stamp).slice(-6);
const refSuivante = () => `PLT-${base}-${String(++compteur).padStart(3, "0")}`;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Rapprochement ${stamp}`, slug: `rappro-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `rappro-${stamp}@example.test`, passwordHash: "x",
    prenom: "R", nom: "P", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(paymentsTable).where(eq(paymentsTable.organisationId, orgId));
    await db.delete(invoicesTable).where(eq(invoicesTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

async function rapprocher() {
  return request(appli()).post("/api/billing/match-payments").send({});
}

describe("le rapprochement automatique regarde le montant", () => {
  it("un acompte ne solde pas la facture", async () => {
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("10.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).status, "10 EUR ont solde 588 EUR").not.toBe("payee");
  });

  it("l'acompte la met en reglement partiel, pas en attente", async () => {
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("10.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).status).toBe("partiel");
  });

  it("et elle ne porte pas de date de reglement", async () => {
    // `paidAt` renseigne sur une facture non soldee la fait sortir des
    // relances aussi surement qu'un statut « payee ».
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("10.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).paidAt).toBeNull();
  });

  it("un virement du montant TTC exact la solde", async () => {
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("588.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).status).toBe("payee");
  });

  it("et elle porte alors sa date de reglement", async () => {
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("588.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).paidAt).not.toBeNull();
  });

  it("le montant de reference est le TTC, pas le HT", async () => {
    // Le coeur de la regle: 490 EUR, c'est le hors taxes. Le client doit 588.
    // Prendre le HT pour reference soldait la facture avant la TVA.
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("490.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).status, "le HT a suffi a solder").toBe("partiel");
  });

  it("un virement superieur au du la solde aussi", async () => {
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("600.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    expect((await relire(f.id)).status).toBe("payee");
  });

  it("le paiement reste rapproche meme quand il ne solde pas", async () => {
    // Le rapprochement est juste: c'est bien cette facture-la. Seul le statut
    // etait faux. Ne plus rapprocher du tout serait une regression.
    const ref = refSuivante();
    const f = await facture(ref);
    const p = await virement("10.00", `VIR SEPA DUPONT ${ref}`);
    await rapprocher();
    const [apres] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, p.id));
    expect(apres!.status).toBe("matched");
    expect(apres!.invoiceId).toBe(f.id);
  });

  it("un virement sans reference reconnaissable ne touche a rien", async () => {
    const ref = refSuivante();
    const f = await facture(ref);
    await virement("588.00", "VIR SEPA DUPONT REMBOURSEMENT DIVERS");
    await rapprocher();
    expect((await relire(f.id)).status).toBe("en_attente");
  });

  it("la reponse annonce le nombre de paiements rapproches", async () => {
    const ref = refSuivante();
    await facture(ref);
    await virement("588.00", `VIR SEPA DUPONT ${ref}`);
    const r = await rapprocher();
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/rapproche/i);
  });
});
