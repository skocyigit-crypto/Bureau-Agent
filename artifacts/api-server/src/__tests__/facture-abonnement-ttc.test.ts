/**
 * Le montant reclame au client est le TTC, celui qu'il doit virer.
 *
 * La facture d'abonnement est emise en TTC : `emettreFacturePlateforme` ecrit
 * `vatAmount` et `totalTtc = ht + tva` (services/platform-invoice-issue.ts).
 * Le courriel envoye au client, lui, affichait `totalAmount` — le HORS TAXES
 * — sur sa ligne « TOTAL » et dans son objet.
 *
 * Ce qui rend le defaut couteux, c'est ce qui se trouve juste en dessous dans
 * le meme courriel : l'IBAN, et la reference a mettre en communication. Le
 * client lit un montant, le recopie, et vire 490 EUR pour une facture de
 * 588 EUR. Elle reste « partiellement reglee » pour toujours, et la TVA — due
 * au Tresor qu'elle soit encaissee ou non — n'est jamais recouvree.
 *
 * `routes/billing.ts` porte deja la regle pour l'autre porte : « `totalTtc`
 * est ce que le client doit. `totalAmount` est le HT ».
 *
 * Ces controles CAPTURENT le courriel reellement produit par la route, sur une
 * vraie base. Lire le source dirait que `emission.totalTtc` est ecrit quelque
 * part, pas que c'est ce chiffre-la qui part au client.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Les courriels partis, captures avant le fournisseur. */
const envoyes: Array<{ to: string; subject: string; html: string }> = [];
vi.mock("../services/email", async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  return {
    ...reel,
    sendEmail: async (to: string, subject: string, html: string) => {
      envoyes.push({ to, subject, html });
      return { success: true };
    },
  };
});

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, invoicesTable, organisationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import router from "../routes/license-management";

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

/** Le texte du courriel, balises retirees — ce que le client lit. */
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Abonnement ${stamp}`,
    slug: `abo-${stamp}`,
    maxUsers: 5,
    actif: true,
    email: `client-${stamp}@example.test`,
    autoEmailInvoice: true,
    bankIban: "FR7630006000011234567890189",
  } as any).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `abo-${stamp}@example.test`, passwordHash: "x",
    prenom: "A", nom: "B", role: "super_admin", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
  // Le prix compte: `baseAmount = Number(sub.price)`. A zero, la facture
  // n'aurait pas de TVA et les controles ci-dessous ne mesureraient rien —
  // c'est d'ailleurs ce que leur garde-fou verifie en premier.
  await db.insert(subscriptionsTable).values({
    organisationId: orgId, plan: "professionnel", status: "active", price: "490.00",
  } as any);
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(invoicesTable).where(eq(invoicesTable.organisationId, orgId));
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

// La route refuse de facturer deux fois la meme periode — c'est la bonne
// regle. Chaque controle repart donc d'une organisation sans facture.
beforeEach(async () => {
  envoyes.length = 0;
  await db.delete(invoicesTable).where(eq(invoicesTable.organisationId, orgId));
});

async function genererFacture() {
  const r = await request(appli()).post("/api/license-management/auto-generate-invoice")
    .send({ targetOrgId: orgId });
  return r;
}

describe("le courriel de facture d'abonnement reclame le TTC", () => {
  it("la facture est bien generee et le courriel part", async () => {
    const r = await genererFacture();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(envoyes.length, "aucun courriel capture").toBe(1);
  });

  it("l'objet porte le montant TTC, pas le HT", async () => {
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    const ttc = Number(facture.totalTtc).toFixed(2);
    const ht = Number(facture.totalAmount).toFixed(2);
    expect(ttc, "sans TVA, ce controle ne mesure rien").not.toBe(ht);
    expect(envoyes[0]!.subject, `objet: ${envoyes[0]!.subject}`).toContain(ttc);
  });

  it("et l'objet ne porte PAS le HT a la place", async () => {
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    const ht = Number(facture.totalAmount).toFixed(2);
    expect(envoyes[0]!.subject.replace(/\d{4}-\d{2}/, "")).not.toContain(ht);
  });

  it("le corps affiche le TOTAL TTC", async () => {
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    const corps = texte(envoyes[0]!.html);
    expect(corps).toMatch(/TOTAL TTC/);
    expect(corps).toContain(Number(facture.totalTtc).toFixed(2));
  });

  it("il montre aussi le HT et la TVA, pour que le total s'explique", async () => {
    // Un courriel qui n'annonce qu'un TTC sans sa decomposition se lit comme
    // une augmentation de prix.
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    const corps = texte(envoyes[0]!.html);
    expect(corps).toMatch(/Total HT/);
    expect(corps).toMatch(/TVA/);
    expect(corps).toContain(Number(facture.vatAmount).toFixed(2));
  });

  it("HT + TVA font bien le TTC annonce", async () => {
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    const somme = Number(facture.totalAmount) + Number(facture.vatAmount);
    expect(somme.toFixed(2)).toBe(Number(facture.totalTtc).toFixed(2));
  });

  it("le montant annonce est celui a virer, a cote de l'IBAN", async () => {
    // C'est la proximite des deux qui fait le degat: le client recopie le
    // chiffre qu'il vient de lire.
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    const corps = texte(envoyes[0]!.html);
    expect(corps, "l'IBAN n'est pas dans ce courriel: le controle ne mesure rien")
      .toContain("FR7630006000011234567890189");
    expect(corps).toContain(Number(facture.totalTtc).toFixed(2));
  });

  it("la reference du courriel est celle de la facture emise", async () => {
    const r = await genererFacture();
    const facture = (await db.select().from(invoicesTable)
      .where(eq(invoicesTable.id, r.body.invoice.id)))[0]!;
    expect(facture.reference, "la facture n'a pas ete emise").toBeTruthy();
    expect(texte(envoyes[0]!.html)).toContain(facture.reference!);
  });

  it("le courriel va a l'adresse de l'organisation", async () => {
    await genererFacture();
    expect(envoyes[0]!.to).toBe(`client-${stamp}@example.test`);
  });

  it("aucun courriel si l'organisation ne l'a pas demande", async () => {
    await db.update(organisationsTable).set({ autoEmailInvoice: false } as any)
      .where(eq(organisationsTable.id, orgId));
    try {
      await genererFacture();
      expect(envoyes.length).toBe(0);
    } finally {
      await db.update(organisationsTable).set({ autoEmailInvoice: true } as any)
        .where(eq(organisationsTable.id, orgId));
    }
  });
});
