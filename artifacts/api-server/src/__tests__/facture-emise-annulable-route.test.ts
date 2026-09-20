/**
 * Le gel d'une facture emise, mesure PAR LA ROUTE et non par la fonction pure.
 *
 * `frozenFieldsTouched` compare la valeur proposee a la valeur actuelle, pour
 * qu'un formulaire renvoye tel quel ne compte pas comme une reecriture. Un
 * champ ABSENT de l'etat actuel y est traite comme modifie — la bonne regle
 * par defaut : on ne declare pas identique ce qu'on n'a pas lu.
 *
 * Mais la route ne lisait que deux colonnes :
 *
 *     db.select({ id: ..., status: ... })
 *
 * Aucun des treize champs geles n'etait donc dans l'etat actuel, tous etaient
 * declares modifies a valeur identique, et le 409 revenait sur le simple
 * changement de statut. La remediation que le serveur propose lui-meme —
 * « annulez la facture » — passe par ce PATCH : plus aucune facture emise
 * n'etait annulable depuis le produit.
 *
 * `facture-emise-modifiable.test.ts` restait vert : il appelle la fonction
 * pure avec une facture COMPLETE, c'est-a-dire avec ce que la route ne lui
 * donnait pas. Un test qui n'emprunte pas le chemin de l'utilisateur ne dit
 * rien de ce que l'utilisateur obtient — d'ou ces controles-ci, qui passent
 * par le vrai routeur et la vraie base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/factures-client";

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
  a.use("/api", router);
  return a;
}

/** Une facture EMISE, telle que la base la porte reellement. */
async function factureEmise(v: Record<string, unknown> = {}) {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId,
    reference: `FAC-TEST-${stamp}-${Math.floor(Math.random() * 1e6)}`,
    title: "Pose de carrelage",
    clientName: "Dupont SARL",
    clientCompany: "Dupont",
    items: [{ description: "Pose", quantity: 1, unitPrice: 100, taxRate: 20, total: 100 }],
    subtotal: "100.00",
    taxAmount: "20.00",
    totalAmount: "120.00",
    currency: "EUR",
    status: "envoyee",
    ...v,
  } as any).returning();
  return f!;
}

/** Le formulaire COMPLET, tel que l'ecran le renvoie — rien de modifie. */
function formulaireInchange(f: any) {
  return {
    reference: f.reference,
    title: f.title,
    clientName: f.clientName,
    clientCompany: f.clientCompany,
    items: f.items,
    subtotal: f.subtotal,
    taxAmount: f.taxAmount,
    totalAmount: f.totalAmount,
    currency: f.currency,
    isAutoliquidation: f.isAutoliquidation,
    dueDate: f.dueDate,
    clientAddress: f.clientAddress,
    clientSiren: f.clientSiren,
    deliveryAddress: f.deliveryAddress,
    operationCategory: f.operationCategory,
    vatOnDebits: f.vatOnDebits,
  };
}

const relire = async (id: number) =>
  (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Gel ${stamp}`, slug: `gel-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `gel-${stamp}@example.test`, passwordHash: "x",
    prenom: "G", nom: "L", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

describe("une facture emise reste annulable depuis le produit", () => {
  it("annuler avec le formulaire complet est accepte", async () => {
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), status: "annulee" });
    expect(r.status, `refus: ${JSON.stringify(r.body?.champs ?? r.body)}`).toBe(200);
  });

  it("et la facture est vraiment annulee en base", async () => {
    const f = await factureEmise();
    await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), status: "annulee" });
    expect((await relire(f.id)).status).toBe("annulee");
  });

  it("la remediation que le serveur propose fonctionne vraiment", async () => {
    // Le 409 dit « Annulez la facture (statut "annulee") ». Si ce chemin
    // echoue, le message envoie l'utilisateur dans un mur.
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), status: "annulee" });
    expect(r.status).not.toBe(409);
  });

  it("changer le seul statut, sans renvoyer le formulaire, marche aussi", async () => {
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`).send({ status: "annulee" });
    expect(r.status).toBe(200);
  });

  it("les notes internes restent modifiables sur une facture emise", async () => {
    // Elles decrivent la vie de la facture, pas son contenu.
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), notes: "Relance telephonique du 20/09" });
    expect(r.status).toBe(200);
  });
});

describe("le gel du contenu reste entier", () => {
  it("changer le montant d'une facture emise est refuse", async () => {
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), totalAmount: "999.00" });
    expect(r.status).toBe(409);
    expect(r.body.champs).toContain("totalAmount");
  });

  it("changer les lignes est refuse", async () => {
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), items: [{ description: "Autre", quantity: 9, unitPrice: 1, taxRate: 20, total: 9 }] });
    expect(r.status).toBe(409);
    expect(r.body.champs).toContain("items");
  });

  it("changer la reference est refuse", async () => {
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), reference: "FAC-BIDON-1" });
    expect(r.status).toBe(409);
    expect(r.body.champs).toContain("reference");
  });

  it("changer une mention obligatoire est refuse", async () => {
    // Decret n° 2022-1299 : elles font partie du CONTENU de la facture.
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), clientSiren: "552100554" });
    expect(r.status).toBe(409);
    expect(r.body.champs).toContain("clientSiren");
  });

  it("le refus ne nomme QUE le champ reellement change", async () => {
    // Nommer treize champs auxquels l'utilisateur n'a pas touche, c'est lui
    // demander de deviner lequel bloque.
    const f = await factureEmise();
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), totalAmount: "999.00" });
    expect(r.body.champs).toEqual(["totalAmount"]);
  });

  it("un brouillon reste librement modifiable", async () => {
    const f = await factureEmise({ status: "brouillon" });
    const r = await request(appli()).patch(`/api/factures-client/${f.id}`)
      .send({ ...formulaireInchange(f), totalAmount: "999.00", subtotal: "832.50", taxAmount: "166.50" });
    expect(r.status).toBe(200);
  });

  it("une facture d'une autre organisation n'est pas touchable", async () => {
    const [autre] = await db.insert(organisationsTable).values({
      name: `Autre gel ${stamp}`, slug: `autre-gel-${stamp}`, maxUsers: 2, actif: true,
    }).returning({ id: organisationsTable.id });
    try {
      const [f] = await db.insert(facturesClientTable).values({
        organisationId: autre!.id, reference: `FAC-AILLEURS-${stamp}`, title: "Ailleurs",
        clientName: "X", items: [], subtotal: "0.00", taxAmount: "0.00", totalAmount: "0.00",
        currency: "EUR", status: "envoyee",
      } as any).returning();
      const r = await request(appli()).patch(`/api/factures-client/${f!.id}`).send({ status: "annulee" });
      expect(r.status).toBe(404);
      await db.delete(facturesClientTable).where(eq(facturesClientTable.organisationId, autre!.id));
    } finally {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id));
    }
  });
});
