/**
 * Deux portes menent au meme fait comptable ; une seule etait gardee.
 *
 * `POST /api/encaissements` refuse depuis le 18/09 un montant superieur au
 * reste a payer (409 `depasse_reste_a_payer`). Mais `POST
 * /api/license-management/record-payment` inscrit le MEME fait — un reglement
 * sur une facture client — et le traitait autrement : `Math.min` ramenait le
 * cumul au total de la facture.
 *
 * Saisir 1 000,00 sur une facture de 120,00 enregistrait donc 120,00 et
 * repondait « facture soldee ». Le surplus disparaissait sans trace : les
 * livres cessaient de correspondre a la banque, et la faute de frappe restait
 * invisible a celui qui l'avait commise.
 *
 * Une garde qu'une autre route contourne ne garde rien. Ces controles fixent
 * les deux portes sur la meme regle.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, encaissementsTable, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/license-management";

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

async function facture(total = "120.00", dejaPaye = "0") {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId,
    reference: `LM-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Travaux", clientName: "Client", status: "envoyee",
    items: [], subtotal: "100.00", taxAmount: "20.00",
    totalAmount: total, paidAmount: dejaPaye, currency: "EUR",
  } as any).returning({ id: facturesClientTable.id });
  return f!.id;
}

const enregistrer = (corps: Record<string, unknown>) =>
  request(appli()).post("/api/license-management/record-payment").send(corps);

const lire = async (id: number) =>
  (await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, id)))[0];

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Paiement ${stamp}`, slug: `paiement-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `paiement-${stamp}@example.test`,
    passwordHash: "x", prenom: "P", nom: "A", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux en ajout seul */ }
});

describe("un montant superieur au reste a payer", () => {
  it("est refuse au lieu d'etre tronque", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 1000 });
    expect(r.status, "le trop-percu passait et la facture etait dite soldee").toBe(409);
    expect(r.body.code).toBe("depasse_reste_a_payer");
  });

  it("ne touche pas a la facture", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 1000 });
    const f = await lire(id);
    expect(Number(f.paidAmount)).toBe(0);
    expect(f.status, "facture marquee payee par un montant refuse").not.toBe("payee");
  });

  it("dit ce qui reste du, pour que la saisie soit corrigeable", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 20 });
    const r = await enregistrer({ factureClientId: id, amount: 500 });
    expect(r.body.resteAPayer).toBe("100.00");
  });

  it("le dit autrement quand la facture est deja soldee", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 120 });
    const r = await enregistrer({ factureClientId: id, amount: 10 });
    expect(r.body.error).toMatch(/deja entierement reglee/i);
  });

  it("renvoie vers l'avoir, qui est la forme comptable du trop-percu", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 200 });
    expect(r.body.remediation).toMatch(/avoir/i);
  });
});

describe("les reglements legitimes passent toujours", () => {
  it("un acompte est enregistre et laisse la facture ouverte", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 50 });
    expect(r.status).toBe(200);
    expect(r.body.isFullyPaid).toBe(false);
    expect(Number((await lire(id)).paidAmount)).toBe(50);
  });

  it("le solde exact clot la facture", async () => {
    // L acompte prealable passe par la ROUTE: depuis que la chaine fait foi,
    // semer paidAmount en base decrirait un etat que le produit ne peut plus
    // atteindre — et le test ne mesurerait plus rien de reel.
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 100 });
    const r = await enregistrer({ factureClientId: id, amount: 20 });
    expect(r.body.isFullyPaid).toBe(true);
    expect((await lire(id)).status).toBe("payee");
  });

  it("deux acomptes s'additionnent sans deriver au centime", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 0.1 });
    await enregistrer({ factureClientId: id, amount: 0.2 });
    expect(
      Number((await lire(id)).paidAmount),
      "0.1 + 0.2 en flottant vaut 0.30000000000000004",
    ).toBe(0.3);
  });

  it("le paiement au centime pres du reste est accepte", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 119.99 });
    const r = await enregistrer({ factureClientId: id, amount: 0.01 });
    expect(r.status, "arrondi trop strict: le dernier centime deviendrait impayable").toBe(200);
    expect(r.body.isFullyPaid).toBe(true);
  });

  it("un montant nul ou negatif reste refuse", async () => {
    const id = await facture("120.00");
    expect((await enregistrer({ factureClientId: id, amount: 0 })).status).toBe(400);
    expect((await enregistrer({ factureClientId: id, amount: -5 })).status).toBe(400);
  });

  it("une facture d'une autre organisation reste introuvable", async () => {
    const [autre] = await db.insert(organisationsTable).values({
      name: `Autre ${stamp}`, slug: `autre-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    const [f] = await db.insert(facturesClientTable).values({
      organisationId: autre!.id, reference: `X-${stamp}`, title: "T", clientName: "C",
      status: "envoyee", items: [], subtotal: "10.00", taxAmount: "0",
      totalAmount: "10.00", paidAmount: "0", currency: "EUR",
    } as any).returning({ id: facturesClientTable.id });
    expect((await enregistrer({ factureClientId: f!.id, amount: 5 })).status).toBe(404);
    try { await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id)); } catch { /* journaux */ }
  });
});

/**
 * Le journal doit dire ce qui s'est passe, pas ce qu'on esperait.
 *
 * `/license-management/send-invoice-email` ecrivait `invoice_email_sent` meme
 * quand l'envoi avait echoue : l'ecran affichait « Echec de l'envoi » pendant
 * que le journal affirmait l'inverse. Or c'est ce journal qu'on produit le
 * jour ou le client conteste avoir recu la facture — et les penalites de
 * retard se comptent depuis cette date (C. com. L441-10).
 */
describe("la trace d'envoi de facture", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "routes", "license-management.ts"), "utf8",
  );
  const bloc = source.slice(source.indexOf(`"/license-management/send-invoice-email"`));

  it("depend du resultat de l'envoi", () => {
    expect(
      bloc.slice(0, 12000),
      "trace d'envoi ecrite sans regarder si l'envoi a eu lieu",
    ).toMatch(/sent \? "invoice_email_sent" : "invoice_email_failed"/);
  });

  it("l'echec a son propre libelle dans le journal", () => {
    const audit = readFileSync(
      join(import.meta.dirname, "..", "services", "license-audit.ts"), "utf8",
    );
    expect(audit).toContain(`"invoice_email_failed"`);
  });

  it("le message d'echec nomme la facture et le destinataire", () => {
    expect(bloc.slice(0, 12000)).toMatch(/Echec d'envoi de la facture \$\{facture\.reference\} a \$\{facture\.clientEmail\}/);
  });
});

/**
 * Le defaut le plus grave : un paiement qui s'efface tout seul.
 *
 * `facturesClient.paidAmount` n'est pas une donnee, c'est un CACHE recalcule
 * depuis la chaine d'encaissements. Les deux routes d'administration
 * l'ecrivaient directement, sans creer la moindre ecriture. Consequence :
 *
 *  - le journal de caisse — chaine, horodate, verifiable — ignorait ces
 *    reglements ; la facture se disait payee et rien ne disait par quoi ;
 *  - le PREMIER encaissement enregistre ensuite sur la meme facture
 *    declenchait le recalcul du cache depuis les seules ecritures, et le
 *    reglement saisi par l'administration DISPARAISSAIT.
 *
 * Les deux routes passent desormais par la meme ecriture que
 * `/api/encaissements`.
 */
describe("un reglement laisse une ecriture dans le journal", () => {
  it("record-payment cree une ligne d'encaissement", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 50 });
    const lignes = await db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, id));
    expect(lignes, "reglement absent du journal de caisse").toHaveLength(1);
    expect(lignes[0].montantCentimes).toBe(5000);
  });

  it("la ligne est chainee sur la precedente", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 10 });
    await enregistrer({ factureClientId: id, amount: 20 });
    const lignes = await db.select().from(encaissementsTable)
      .where(eq(encaissementsTable.factureId, id)).orderBy(encaissementsTable.numero);
    expect(lignes[1].empreintePrecedente, "chaine rompue").toBe(lignes[0].empreinte);
  });

  it("le montant paye ne disparait pas quand la chaine est recalculee", async () => {
    const id = await facture("120.00");
    await enregistrer({ factureClientId: id, amount: 40 });
    // Recalcul du cache a partir des seules ecritures: c'est ce que fait
    // rafraichirCache au prochain encaissement.
    const lignes = await db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, id));
    const sommeEcritures = lignes.reduce((s, l) => s + l.montantCentimes, 0);
    expect(
      sommeEcritures,
      "le cache affichait un paiement que la chaine ignorait: il s'effacerait au prochain encaissement",
    ).toBe(Math.round(Number((await lire(id)).paidAmount) * 100));
  });

  it("mark-invoice-paid encaisse le reste du, par une ecriture", async () => {
    const id = await facture("120.00", "20.00");
    // Le reste se lit dans la chaine: on part d'une facture sans ecriture,
    // donc le reste vaut le total.
    const r = await request(appli()).post("/api/license-management/mark-invoice-paid")
      .send({ factureClientId: id });
    expect(r.status).toBe(200);
    const lignes = await db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, id));
    expect(lignes.length, "facture soldee sans aucune ecriture").toBeGreaterThan(0);
  });

  it("apres « marquer payee », la chaine et la facture s'accordent", async () => {
    const id = await facture("60.00");
    await request(appli()).post("/api/license-management/mark-invoice-paid").send({ factureClientId: id });
    const lignes = await db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, id));
    const somme = lignes.reduce((s, l) => s + l.montantCentimes, 0);
    const f = await lire(id);
    expect(f.status).toBe("payee");
    expect(somme).toBe(Math.round(Number(f.totalAmount) * 100));
  });

  it("le moyen de paiement inconnu retombe sur le virement, sans casser l'ecriture", async () => {
    const id = await facture("120.00");
    const r = await enregistrer({ factureClientId: id, amount: 10, paymentMethod: "bitcoin" });
    expect(r.status).toBe(200);
    const [ligne] = await db.select().from(encaissementsTable).where(eq(encaissementsTable.factureId, id));
    expect(ligne.moyen).toBe("virement");
  });
});

/**
 * Une seule ecriture possible, pour toutes les portes.
 *
 * La regle (numero continu, empreinte chainee, refus d'une periode close,
 * refus d'un montant superieur au reste du) etait ecrite dans la route
 * `/api/encaissements`. Les routes d'administration, elles, ecrivaient le
 * cache. Tant que la regle vit dans une route, une autre route peut la
 * contourner sans que rien ne le signale.
 */
describe("l'ecriture de caisse vit dans un service", () => {
  const encaissements = readFileSync(
    join(import.meta.dirname, "..", "routes", "encaissements.ts"), "utf8",
  );
  const licence = readFileSync(
    join(import.meta.dirname, "..", "routes", "license-management.ts"), "utf8",
  );

  it("la route /encaissements passe par le service", () => {
    expect(encaissements).toMatch(/enregistrerEncaissement\(\{/);
  });

  it("les routes d'administration aussi", () => {
    const appels = licence.match(/await enregistrerEncaissement\(\{/g) ?? [];
    expect(appels.length, "record-payment et mark-invoice-paid doivent l'appeler").toBe(2);
  });

  it("le cache n'est jamais ecrit depuis une valeur qui ne vient pas de la chaine", () => {
    // La regle n'est pas « ne jamais ecrire paidAmount » — il FAUT l'ecrire,
    // c'est un cache. C'est sa SOURCE qui compte: seul un recalcul par
    // `soldeFacture` sur les ecritures peut l'alimenter. Une valeur calculee
    // a partir du cache precedent, ou fournie par l'appelant, est le defaut
    // qu'on vient de retirer.
    // On ne regarde que les ECRITURES: un `paidAmount` dans un SELECT ou dans
    // une reponse JSON est une lecture, elle ne pose aucun probleme.
    for (const [nom, source] of [["encaissements", encaissements], ["license-management", licence]] as const) {
      for (const bloc of source.matchAll(/\.set\(\{[\s\S]{0,400}?\}\)/g)) {
        if (!/paidAmount:/.test(bloc[0])) continue;
        const avant = source.slice(Math.max(0, bloc.index - 600), bloc.index);
        expect(
          /soldeFacture\(/.test(avant),
          `${nom}: paidAmount ecrit sans recalcul de la chaine — « ${bloc[0].replace(/\s+/g, " ").slice(0, 90)} »`,
        ).toBe(true);
      }
    }
  });
});
