/**
 * Deux statuts etaient lus partout et ecrits nulle part.
 *
 * `retard`, pour les factures de la plateforme, est interroge en six endroits
 * — tableau de bord de l'editeur, agent SaaS, resume de facturation, relances.
 * Aucun chemin de code ne l'ecrivait, sauf une modification manuelle du
 * statut : le montant « en retard » affiche valait donc toujours zero, et un
 * impaye ne ressemblait a rien.
 *
 * `expire`, pour les devis, fait partie des statuts reconnus et la colonne
 * `valid_until` porte la date de validite — mais rien ne rapprochait les deux.
 * Un devis restait « envoye » indefiniment, et restait CONVERTIBLE en facture :
 * un devis de l'an dernier produisait une facture a l'ancien prix, alors que la
 * duree de validite est precisement ce qui protege l'entreprise contre la
 * hausse du cout des materiaux.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, devisTable, invoicesTable, organisationsTable, usersTable } from "@workspace/db";
import devisRouter from "../routes/devis";
import { basculerFacturesEnRetard, DELAI_REGLEMENT_JOURS, estEnRetard } from "../services/factures-en-retard";
import { basculerDevisExpires, devisExpire } from "../services/devis-expires";

const stamp = Date.now();
const JOUR = 24 * 60 * 60 * 1000;
let orgId = 0, userId = 0;

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: "administrateur" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", devisRouter);
  return a;
}

async function facturePlateforme(statut: string, emiseIlYA: number | null): Promise<number> {
  const [f] = await db.insert(invoicesTable).values({
    organisationId: orgId, periodLabel: "2026-08",
    periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"),
    plan: "pro", totalAmount: "408.33", vatRate: "20.00", vatAmount: "81.67",
    totalTtc: "490.00", currency: "EUR", status: statut,
    issuedAt: emiseIlYA === null ? null : new Date(Date.now() - emiseIlYA),
  } as any).returning({ id: invoicesTable.id });
  return f!.id;
}

async function unDevis(statut: string, validUntil: Date | null): Promise<number> {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: `DEV-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Ravalement", clientName: "Client", items: [],
    subtotal: "1000.00", taxAmount: "200.00", totalAmount: "1200.00",
    status: statut, validUntil,
  } as any).returning({ id: devisTable.id });
  return d!.id;
}

async function statutFacture(id: number) {
  const [f] = await db.select({ s: invoicesTable.status }).from(invoicesTable).where(eq(invoicesTable.id, id));
  return f!.s;
}
async function statutDevis(id: number) {
  const [d] = await db.select({ s: devisTable.status }).from(devisTable).where(eq(devisTable.id, id));
  return d!.s;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Statuts ${stamp}`, slug: `statuts-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `statuts-${stamp}@example.test`,
    passwordHash: "x", prenom: "S", nom: "T", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("une facture de plateforme impayee finit par etre en retard", () => {
  it("une facture emise et impayee bascule", async () => {
    const f = await facturePlateforme("en_attente", 30 * JOUR);
    await basculerFacturesEnRetard();
    expect(await statutFacture(f), "le montant « en retard » affiche valait toujours zero").toBe("retard");
  });

  it("une facture partiellement reglee aussi", async () => {
    const f = await facturePlateforme("partiel", 30 * JOUR);
    await basculerFacturesEnRetard();
    expect(await statutFacture(f)).toBe("retard");
  });

  it("une facture emise hier ne bascule pas", async () => {
    // Un virement met plusieurs jours a arriver: traiter comme impaye un
    // client qui a paye la veille serait faux.
    const f = await facturePlateforme("en_attente", 1 * JOUR);
    await basculerFacturesEnRetard();
    expect(await statutFacture(f)).toBe("en_attente");
  });

  it("la tolerance de transit est celle annoncee", () => {
    expect(estEnRetard("en_attente", new Date(Date.now() - (DELAI_REGLEMENT_JOURS + 1) * JOUR))).toBe(true);
    expect(estEnRetard("en_attente", new Date(Date.now() - (DELAI_REGLEMENT_JOURS - 1) * JOUR))).toBe(false);
  });

  it("un brouillon n'est du par personne", async () => {
    const f = await facturePlateforme("en_attente", null);
    await basculerFacturesEnRetard();
    expect(await statutFacture(f), "un brouillon n'a jamais ete emis").toBe("en_attente");
  });

  it("une facture soldee n'y revient jamais", async () => {
    const f = await facturePlateforme("payee", 90 * JOUR);
    await basculerFacturesEnRetard();
    expect(await statutFacture(f)).toBe("payee");
  });

  it("une facture annulee non plus", async () => {
    const f = await facturePlateforme("annulee", 90 * JOUR);
    await basculerFacturesEnRetard();
    expect(await statutFacture(f)).toBe("annulee");
  });

  it("un second passage ne reprend rien", async () => {
    await facturePlateforme("en_attente", 30 * JOUR);
    await basculerFacturesEnRetard();
    expect(await basculerFacturesEnRetard(), "la bascule doit etre idempotente").toEqual([]);
  });
});

describe("un devis dont la validite est passee expire", () => {
  it("un devis envoye et echu bascule", async () => {
    const d = await unDevis("envoye", new Date(Date.now() - 5 * JOUR));
    await basculerDevisExpires();
    expect(await statutDevis(d)).toBe("expire");
  });

  it("un devis encore valable ne bouge pas", async () => {
    const d = await unDevis("envoye", new Date(Date.now() + 5 * JOUR));
    await basculerDevisExpires();
    expect(await statutDevis(d)).toBe("envoye");
  });

  it("un devis sans date de validite n'expire pas", async () => {
    // Une absence de terme n'est pas un terme depasse.
    const d = await unDevis("envoye", null);
    await basculerDevisExpires();
    expect(await statutDevis(d)).toBe("envoye");
  });

  it("un devis accepte garde son issue", async () => {
    const d = await unDevis("accepte", new Date(Date.now() - 5 * JOUR));
    await basculerDevisExpires();
    expect(await statutDevis(d)).toBe("accepte");
  });

  it("un brouillon jamais propose non plus", async () => {
    const d = await unDevis("brouillon", new Date(Date.now() - 5 * JOUR));
    await basculerDevisExpires();
    expect(await statutDevis(d)).toBe("brouillon");
  });

  it("la regle, isolement", () => {
    expect(devisExpire("envoye", new Date(Date.now() - 1000))).toBe(true);
    expect(devisExpire("envoye", new Date(Date.now() + 1000))).toBe(false);
    expect(devisExpire("refuse", new Date(Date.now() - 1000))).toBe(false);
  });
});

describe("un devis echu ne se convertit plus en facture", () => {
  it("la conversion est refusee, et dit pourquoi", async () => {
    const d = await unDevis("envoye", new Date(Date.now() - 400 * JOUR));
    const r = await request(appli()).post(`/api/devis/${d}/convert-to-facture`).send({});
    expect(r.status, "un devis de l'an dernier produisait une facture a l'ancien prix").toBe(409);
    expect(r.body.code).toBe("devis_expire");
  });

  it("le refus nomme l'action qui debloque", async () => {
    const d = await unDevis("envoye", new Date(Date.now() - 400 * JOUR));
    const r = await request(appli()).post(`/api/devis/${d}/convert-to-facture`).send({});
    expect(r.body.remediation).toMatch(/validite/i);
  });

  it("un devis encore valable se convertit toujours", async () => {
    // Garde-fou: un refus qui bloquerait TOUT serait pire que le defaut.
    const d = await unDevis("envoye", new Date(Date.now() + 30 * JOUR));
    const r = await request(appli()).post(`/api/devis/${d}/convert-to-facture`).send({});
    expect(r.status, "le chemin normal doit rester ouvert").toBe(201);
  });
});
