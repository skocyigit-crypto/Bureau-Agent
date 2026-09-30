/**
 * Le dossier d'un chantier, sur une vraie base (plan du 29/09, sections 6 et 8).
 *
 * Ce que ces tests prouvent, et pourquoi chacun :
 *  - les cinq montants additionnent ce qui est RATTACHE au chantier, et
 *    seulement ce qui compte (devis accepte, depense approuvee, facture
 *    emise, journal des encaissements) ;
 *  - chaque montant porte les lignes qui le composent : on peut refaire
 *    l'addition, le plan l'exige ;
 *  - un avenant ne compte dans l'engage que lorsque SON devis est accepte, et
 *    ne touche jamais au devis initial ;
 *  - « Aujourd'hui » voit enfin le depassement sur un chantier ouvert depuis
 *    un devis (il ne le pouvait pas : `budget` y est nul) ;
 *  - la facture issue d'un devis rejoint le chantier de ce devis, par les
 *    DEUX chemins de facturation ;
 *  - rien ne traverse les organisations.
 *
 * Les routeurs sont les vrais ; seule la session est posee a la main.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogsTable, avenantsTable, calendarEventsTable, callsTable, db, depensesTable, devisTable,
  documentsTable, encaissementsTable, facturesClientTable, journalChantierTable, organisationsTable,
  projetsTable, usersTable,
} from "@workspace/db";
import chantierRouter from "../routes/chantier";
import devisRouter from "../routes/devis";
import facturesClientRouter from "../routes/factures-client";
import depensesRouter from "../routes/depenses";
import { enregistrerEncaissement } from "../services/encaissement-enregistrement";
import { construireMasaBugun } from "../services/masa-bugun";
import { montantsDuChantier } from "../services/dossier-chantier";

const stamp = Date.now();
const ids: Record<string, number> = {};
const JOUR = 24 * 60 * 60 * 1000;

function appli(orgId = ids.orgA, role = "administrateur", userId = ids.admin) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, role, userEmail: `x-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", chantierRouter);
  a.use("/api", devisRouter);
  a.use("/api", facturesClientRouter);
  a.use("/api", depensesRouter);
  return a;
}

let seq = 0;
const ref = (p: string) => `${p}-${stamp}-${++seq}`;

async function unDevis(v: Record<string, unknown> = {}, orgId = ids.orgA) {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: ref("DV"), title: "Ravalement", clientName: "SCI Duval",
    items: [], subtotal: "10000.00", taxAmount: "2000.00", totalAmount: "12000.00",
    status: "accepte", acceptedAt: new Date(), validUntil: new Date(Date.now() + 30 * JOUR), ...v,
  } as any).returning();
  return d!;
}

/** Un chantier ouvert depuis un devis accepte, par la vraie route : `budget` y reste nul. */
async function unChantierDepuisDevis(total = "12000.00", orgId = ids.orgA) {
  const d = await unDevis({ totalAmount: total }, orgId);
  const r = await request(appli(orgId)).post(`/api/devis/${d.id}/chantier`).send({});
  expect(r.status, r.text).toBe(201);
  return { devis: d, projetId: r.body.projet.id as number };
}

async function uneDepense(projetId: number | null, ttc: string, status = "approuve", orgId = ids.orgA) {
  const [d] = await db.insert(depensesTable).values({
    organisationId: orgId, projetId, vendor: "Point P", amountTtc: ttc, amountHt: ttc, status,
    expenseDate: new Date(), source: "manuel",
  } as any).returning();
  return d!;
}

async function uneFacture(projetId: number | null, total: string, status = "envoyee", orgId = ids.orgA) {
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, projetId, reference: ref("FC"), title: "Situation", clientName: "SCI Duval",
    subtotal: total, taxAmount: "0", totalAmount: total, status,
  } as any).returning();
  return f!;
}

const ligne = { description: "Reprise d'enduit", quantity: 1, unitPrice: 1000, taxRate: 20, total: 1000 };

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Dossier ${k} ${stamp}`, slug: `dos-${k.toLowerCase()}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const [u] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `admin-dos-${stamp}@exemple.test`, passwordHash: "x", prenom: "Ada", nom: "Admin", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.admin = u!.id;
  const [b] = await db.insert(usersTable).values({ organisationId: ids.orgB, email: `admin-dosb-${stamp}@exemple.test`, passwordHash: "x", prenom: "Bea", nom: "Autre", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  ids.adminB = b!.id;
});

afterAll(async () => {
  try {
    for (const o of [ids.orgA, ids.orgB]) {
      await db.delete(journalChantierTable).where(eq(journalChantierTable.organisationId, o));
      await db.delete(avenantsTable).where(eq(avenantsTable.organisationId, o));
      await db.delete(depensesTable).where(eq(depensesTable.organisationId, o));
      await db.delete(callsTable).where(eq(callsTable.organisationId, o));
      await db.delete(calendarEventsTable).where(eq(calendarEventsTable.organisationId, o));
      await db.delete(documentsTable).where(eq(documentsTable.organisationId, o));
      await db.delete(projetsTable).where(eq(projetsTable.organisationId, o));
      await db.delete(devisTable).where(eq(devisTable.organisationId, o));
    }
    // Factures et encaissements : le journal est inalterable (pas de DELETE),
    // et l'audit peut retenir l'organisation. On laisse la base jetable.
  } catch { /* base de test jetable */ }
});

describe("les cinq montants", () => {
  it("un chantier ouvert depuis un devis a pour engage le prix accepte — pas son budget, qui reste nul", async () => {
    const { projetId } = await unChantierDepuisDevis("12000.00");
    const [p] = await db.select().from(projetsTable).where(eq(projetsTable.id, projetId));
    expect(p!.budget, "la route d'ouverture ne remplit pas budget : c'est le point de depart du defaut").toBeNull();
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.teklif.toplam).toBe(12000);
    expect(m.onayliIs).toBe(12000);
    expect(m.butcePrevision).toBeNull();
  });

  it("n'additionne que les depenses APPROUVEES du chantier", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const a = await uneDepense(projetId, "1500.00", "approuve");
    await uneDepense(projetId, "999.00", "en_attente");
    await uneDepense(projetId, "888.00", "rejete");
    await uneDepense(null, "777.00", "approuve");
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.gider.toplam).toBe(1500);
    expect(m.gider.adet).toBe(1);
    expect(m.gider.kaynaklar.map((k) => k.id)).toEqual([a.id]);
  });

  it("n'additionne que les factures EMISES : ni brouillon, ni annulee", async () => {
    const { projetId } = await unChantierDepuisDevis();
    await uneFacture(projetId, "3000.00", "envoyee");
    await uneFacture(projetId, "2000.00", "payee");
    await uneFacture(projetId, "5000.00", "brouillon");
    await uneFacture(projetId, "4000.00", "annulee");
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.faturalanan.toplam).toBe(5000);
    expect(m.faturalanan.adet).toBe(2);
  });

  it("l'encaisse vient du JOURNAL, annulation comprise — pas du cache paid_amount", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const f = await uneFacture(projetId, "3000.00", "envoyee");
    // Le cache ment : il annonce 3000 encaisses. Le journal dira 1000.
    await db.update(facturesClientTable).set({ paidAmount: "3000.00" }).where(eq(facturesClientTable.id, f.id));
    const r1 = await enregistrerEncaissement({ organisationId: ids.orgA, factureId: f.id, montantCentimes: 150000, moyen: "virement" });
    expect(r1.ok).toBe(true);
    const r2 = await enregistrerEncaissement({ organisationId: ids.orgA, factureId: f.id, montantCentimes: -50000, moyen: "virement", forcer: true });
    expect(r2.ok).toBe(true);
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.tahsilEdilen.toplam).toBe(1000);
    expect(m.tahsilEdilmeyen).toBe(2000);
  });

  it("marge, reste a facturer et reste a encaisser sont des soustractions de faits", async () => {
    const { projetId } = await unChantierDepuisDevis("10000.00");
    await uneDepense(projetId, "4000.00");
    const f = await uneFacture(projetId, "6000.00");
    await enregistrerEncaissement({ organisationId: ids.orgA, factureId: f.id, montantCentimes: 250000, moyen: "cheque" });
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.marj).toBe(6000);
    expect(m.faturalanmayan).toBe(4000);
    expect(m.tahsilEdilmeyen).toBe(3500);
    expect(m.asim).toBe(false);
  });

  it("chaque source mene a sa fiche", async () => {
    const { projetId, devis } = await unChantierDepuisDevis();
    const d = await uneDepense(projetId, "100.00");
    const f = await uneFacture(projetId, "200.00");
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.teklif.kaynaklar[0]).toMatchObject({ tur: "devis", id: devis.id, href: `/devis?id=${devis.id}` });
    expect(m.gider.kaynaklar[0]).toMatchObject({ tur: "depense", id: d.id, href: `/depenses?id=${d.id}` });
    expect(m.faturalanan.kaynaklar[0]).toMatchObject({ tur: "facture", id: f.id, href: `/factures?id=${f.id}` });
  });

  it("un devis initial repasse en brouillon ne compte plus dans l'engage", async () => {
    const { projetId, devis } = await unChantierDepuisDevis("8000.00");
    await db.update(devisTable).set({ status: "brouillon" }).where(eq(devisTable.id, devis.id));
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.teklif.toplam).toBe(0);
    expect(m.onayliIs).toBe(0);
  });
});

describe("les avenants", () => {
  it("ouvrir un avenant cree un devis BROUILLON rattache, sans toucher au devis initial", async () => {
    const { projetId, devis } = await unChantierDepuisDevis("12000.00");
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({
      title: "Reprise des appuis de fenetre", motif: "Appuis fissures decouverts a la depose", items: [ligne],
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body.devis.status).toBe("brouillon");
    expect(r.body.devis.reference).toMatch(/^AVN-/);
    expect(r.body.avenant).toMatchObject({ projetId, devisId: r.body.devis.id });
    const [initial] = await db.select().from(devisTable).where(eq(devisTable.id, devis.id));
    expect(initial!.totalAmount).toBe("12000.00");
    expect(initial!.items).toEqual([]);
    const traces = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.action, "chantier.avenant_ouvert"), eq(auditLogsTable.resourceId, String(r.body.avenant.id))));
    expect(traces).toHaveLength(1);
  });

  it("un avenant en brouillon ne vaut rien ; accepte, il s'ajoute a l'engage", async () => {
    const { projetId } = await unChantierDepuisDevis("12000.00");
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "Supplement", motif: "Demande du client", items: [ligne] });
    expect(r.status).toBe(201);
    const avant = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(avant.ekIsler.toplam, "brouillon : zero").toBe(0);
    expect(avant.onayliIs).toBe(12000);

    await db.update(devisTable).set({ status: "envoye" }).where(eq(devisTable.id, r.body.devis.id));
    expect((await montantsDuChantier(ids.orgA, projetId))!.ekIsler.toplam, "envoye : toujours zero").toBe(0);

    await db.update(devisTable).set({ status: "accepte", acceptedAt: new Date() }).where(eq(devisTable.id, r.body.devis.id));
    const apres = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(apres.ekIsler.toplam).toBe(1200);
    expect(apres.onayliIs).toBe(13200);
    expect(apres.ekIsler.kaynaklar[0]!.detay).toBe("Demande du client");
  });

  it("un avenant en attente reste VISIBLE dans le dossier, avec son etat, sans etre compte", async () => {
    const { projetId } = await unChantierDepuisDevis("12000.00");
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "Garde-corps", motif: "Exige par le bureau de controle", items: [ligne] });
    const d = await request(appli()).get(`/api/projets/${projetId}/dossier`);
    const vu = d.body.onglets.avenantlar.find((a: any) => a.id === r.body.avenant.id);
    expect(vu).toMatchObject({ statut: "brouillon", tutar: 1200, motif: "Exige par le bureau de controle", devisId: r.body.devis.id });
    expect(d.body.montants.ekIsler.toplam, "visible, mais pas compte").toBe(0);
  });

  it("un avenant refuse ne compte pas", async () => {
    const { projetId } = await unChantierDepuisDevis("5000.00");
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "Option", motif: "Proposee", items: [ligne] });
    await db.update(devisTable).set({ status: "refuse" }).where(eq(devisTable.id, r.body.devis.id));
    expect((await montantsDuChantier(ids.orgA, projetId))!.onayliIs).toBe(5000);
  });

  it("refuse un avenant sans motif, et un avenant sans ligne chiffree", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const sansMotif = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "X", items: [ligne] });
    expect(sansMotif.status).toBe(400);
    expect(sansMotif.body.code).toBe("motif_manquant");
    const sansLigne = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "X", motif: "Y", items: [] });
    expect(sansLigne.status).toBe(400);
    expect(sansLigne.body.code).toBe("lignes_manquantes");
    const avenants = await db.select().from(avenantsTable).where(eq(avenantsTable.projetId, projetId));
    expect(avenants).toHaveLength(0);
  });

  it("le marche initial d'un chantier ne peut pas en devenir l'avenant", async () => {
    const { projetId, devis } = await unChantierDepuisDevis();
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: devis.id, motif: "Erreur" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_est_marche_initial");
    // S'il passait, l'engage compterait le meme prix deux fois.
    expect((await montantsDuChantier(ids.orgA, projetId))!.onayliIs).toBe(12000);
  });

  it("un devis n'est l'avenant que d'un seul chantier", async () => {
    const c1 = await unChantierDepuisDevis();
    const c2 = await unChantierDepuisDevis();
    const libre = await unDevis({ status: "accepte", totalAmount: "700.00" });
    const r1 = await request(appli()).post(`/api/projets/${c1.projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "Supplement" });
    expect(r1.status, r1.text).toBe(201);
    const r2 = await request(appli()).post(`/api/projets/${c2.projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "Supplement" });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe("devis_deja_avenant");
    const encore = await request(appli()).post(`/api/projets/${c1.projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "Supplement" });
    expect(encore.status, "meme chantier : idempotent").toBe(200);
    expect(encore.body.dejaRattache).toBe(true);
  });

  it("deux rattachements simultanes du meme devis n'en gardent qu'un", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const libre = await unDevis({ status: "accepte", totalAmount: "300.00" });
    const [a, b] = await Promise.all([
      request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "M" }),
      request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "M" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    const lignes = await db.select().from(avenantsTable).where(eq(avenantsTable.devisId, libre.id));
    expect(lignes).toHaveLength(1);
  });
});

describe("la facture rejoint le chantier de son devis", () => {
  it("par la conversion devis -> facture", async () => {
    const { projetId, devis } = await unChantierDepuisDevis();
    const r = await request(appli()).post(`/api/devis/${devis.id}/convert-to-facture`).send({});
    expect(r.status, r.text).toBe(201);
    expect(r.body.facture.projetId).toBe(projetId);
  });

  it("par la conversion d'un AVENANT accepte : la facture va au chantier de l'avenant", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const av = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "Sup", motif: "M", items: [ligne] });
    await db.update(devisTable).set({ status: "accepte", acceptedAt: new Date() }).where(eq(devisTable.id, av.body.devis.id));
    const r = await request(appli()).post(`/api/devis/${av.body.devis.id}/convert-to-facture`).send({});
    expect(r.status, r.text).toBe(201);
    expect(r.body.facture.projetId).toBe(projetId);
  });

  it("par POST /factures-client avec un devisId : le chantier est deduit", async () => {
    const { projetId, devis } = await unChantierDepuisDevis();
    const r = await request(appli()).post("/api/factures-client").send({
      title: "Facture", clientName: "SCI Duval", devisId: devis.id, items: [ligne],
    });
    expect(r.status, r.text).toBe(201);
    expect(r.body.projetId).toBe(projetId);
  });

  it("POST /factures-client refuse un chantier qui contredit celui du devis", async () => {
    const c1 = await unChantierDepuisDevis();
    const c2 = await unChantierDepuisDevis();
    const r = await request(appli()).post("/api/factures-client").send({
      title: "Facture", clientName: "SCI Duval", devisId: c1.devis.id, projetId: c2.projetId, items: [ligne],
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("chantier_different_du_devis");
  });
});

describe("Aujourd'hui voit enfin le depassement", () => {
  it("un chantier ouvert depuis un devis, dont la depense depasse l'accepte, apparait — budget nul ou pas", async () => {
    const { projetId } = await unChantierDepuisDevis("2000.00");
    await uneDepense(projetId, "2600.00");
    const masa = await construireMasaBugun(ids.orgA, new Date());
    const l = masa.finans.satirlar.find((s) => s.cle === `butce_asimi:${projetId}`);
    expect(l, "la ligne ne pouvait pas exister avant : budget nul").toBeTruthy();
    expect(l!.tutar).toBe(600);
    expect(l!.detay).toBe("onayli_is");
    expect(l!.href).toBe(`/projets/${projetId}`);
  });

  it("un avenant accepte releve le plafond : la ligne disparait", async () => {
    const { projetId } = await unChantierDepuisDevis("2000.00");
    await uneDepense(projetId, "2600.00");
    const av = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({
      title: "Sup", motif: "Demande", items: [{ ...ligne, unitPrice: 1000, total: 1000 }],
    });
    await db.update(devisTable).set({ status: "accepte", acceptedAt: new Date() }).where(eq(devisTable.id, av.body.devis.id));
    const masa = await construireMasaBugun(ids.orgA, new Date());
    expect(masa.finans.satirlar.find((s) => s.cle === `butce_asimi:${projetId}`)).toBeUndefined();
  });

  it("un chantier SANS prix accepte n'est jamais en depassement, meme avec des depenses", async () => {
    // Sans cette condition, tout chantier ouvert a la main (sans devis) et qui
    // a depense un euro s'afficherait en rouge : un faux signal sur chaque
    // chantier hors parcours commercial, qui noierait les vrais.
    const [p] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Chantier sans devis" }).returning();
    await uneDepense(p!.id, "3000.00");
    const m = (await montantsDuChantier(ids.orgA, p!.id))!;
    expect(m.onayliIs).toBe(0);
    expect(m.gider.toplam).toBe(3000);
    expect(m.asim, "rien d'accepte : on ne peut pas depasser").toBe(false);
    const masa = await construireMasaBugun(ids.orgA, new Date());
    expect(masa.finans.satirlar.find((s) => s.cle === `butce_asimi:${p!.id}`)).toBeUndefined();
    const r = await request(appli()).get("/api/finance/affaires");
    expect(r.body.lignes.find((x: any) => x.id === p!.id).asim).toBe(false);
  });

  it("une depense en attente d'inspection ne fait pas clignoter un depassement", async () => {
    const { projetId } = await unChantierDepuisDevis("1000.00");
    await uneDepense(projetId, "5000.00", "en_attente");
    const masa = await construireMasaBugun(ids.orgA, new Date());
    expect(masa.finans.satirlar.find((s) => s.cle === `butce_asimi:${projetId}`)).toBeUndefined();
  });
});

describe("la comparaison par affaire", () => {
  it("met les cinq montants cote a cote, et les memes que le dossier", async () => {
    const { projetId } = await unChantierDepuisDevis("9000.00");
    await uneDepense(projetId, "3000.00");
    const f = await uneFacture(projetId, "4500.00");
    await enregistrerEncaissement({ organisationId: ids.orgA, factureId: f.id, montantCentimes: 200000, moyen: "virement" });
    const r = await request(appli()).get("/api/finance/affaires");
    expect(r.status, r.text).toBe(200);
    const l = r.body.lignes.find((x: any) => x.id === projetId);
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(l).toMatchObject({
      teklif: m.teklif.toplam, ekIsler: m.ekIsler.toplam, onayliIs: m.onayliIs, gider: m.gider.toplam,
      faturalanan: m.faturalanan.toplam, tahsilEdilen: m.tahsilEdilen.toplam, marj: m.marj,
    });
    expect(l).toMatchObject({ teklif: 9000, gider: 3000, faturalanan: 4500, tahsilEdilen: 2000, faturalanmayan: 4500 });
  });

  it("n'affiche aucun chantier d'une autre organisation", async () => {
    const autre = await unChantierDepuisDevis("1.00", ids.orgB);
    const r = await request(appli()).get("/api/finance/affaires");
    expect(r.body.lignes.some((x: any) => x.id === autre.projetId)).toBe(false);
  });
});

describe("le dossier et ses onglets", () => {
  it("rend la fiche, les montants et le contenu des onglets en une reponse", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const r = await request(appli()).get(`/api/projets/${projetId}/dossier`);
    expect(r.status, r.text).toBe(200);
    expect(r.body.projet.id).toBe(projetId);
    expect(Object.keys(r.body.onglets).sort()).toEqual(["avenantlar", "belgeler", "ekip", "gorevler", "gorusmeler", "gunluk", "planning"]);
    expect(r.body.montants.onayliIs).toBe(12000);
  });

  it("le chantier d'une autre organisation rend 404, comme un chantier inexistant", async () => {
    const autre = await unChantierDepuisDevis("1.00", ids.orgB);
    const r = await request(appli()).get(`/api/projets/${autre.projetId}/dossier`);
    expect(r.status).toBe(404);
    const inexistant = await request(appli()).get("/api/projets/999999999/dossier");
    expect(inexistant.status).toBe(404);
    expect(r.body).toEqual(inexistant.body);
  });

  it("un appel et un creneau se rattachent et apparaissent dans les onglets", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const [appel] = await db.insert(callsTable).values({ organisationId: ids.orgA, phoneNumber: "+33600000000", direction: "entrant", status: "repondu", contactName: "Mme Duval" }).returning();
    const [ev] = await db.insert(calendarEventsTable).values({ organisationId: ids.orgA, title: "Pose echafaudage", type: "chantier", startDate: new Date(), endDate: new Date(Date.now() + 3600e3) }).returning();
    expect((await request(appli()).post(`/api/calls/${appel!.id}/chantier`).send({ projetId })).status).toBe(200);
    expect((await request(appli()).post(`/api/calendar/events/${ev!.id}/chantier`).send({ projetId })).status).toBe(200);
    const d = await request(appli()).get(`/api/projets/${projetId}/dossier`);
    expect(d.body.onglets.gorusmeler.map((x: any) => x.id)).toContain(appel!.id);
    expect(d.body.onglets.planning.map((x: any) => x.id)).toContain(ev!.id);
    const detache = await request(appli()).post(`/api/calls/${appel!.id}/chantier`).send({ projetId: null });
    expect(detache.body.projetId).toBeNull();
  });

  it("on ne rattache pas un appel au chantier d'une autre organisation", async () => {
    const autre = await unChantierDepuisDevis("1.00", ids.orgB);
    const [appel] = await db.insert(callsTable).values({ organisationId: ids.orgA, phoneNumber: "+33600000001", direction: "entrant", status: "repondu" }).returning();
    const r = await request(appli()).post(`/api/calls/${appel!.id}/chantier`).send({ projetId: autre.projetId });
    expect(r.status).toBe(400);
    const [relu] = await db.select().from(callsTable).where(eq(callsTable.id, appel!.id));
    expect(relu!.projetId).toBeNull();
  });

  it("une depense se rattache par PATCH, et le rattachement a un chantier etranger est refuse", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const autre = await unChantierDepuisDevis("1.00", ids.orgB);
    const d = await uneDepense(null, "450.00");
    const ok = await request(appli()).patch(`/api/depenses/${d.id}`).send({ projetId });
    expect(ok.status, ok.text).toBe(200);
    expect((await montantsDuChantier(ids.orgA, projetId))!.gider.toplam).toBe(450);
    const ko = await request(appli()).patch(`/api/depenses/${d.id}`).send({ projetId: autre.projetId });
    expect(ko.status).toBe(400);
    const [relue] = await db.select().from(depensesTable).where(eq(depensesTable.id, d.id));
    expect(relue!.projetId).toBe(projetId);
  });
});

describe("le journal de chantier", () => {
  it("ecrit une note, et un second envoi du meme jour la complete au lieu d'en creer une autre", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const a = await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-29", travaux: "Montage echafaudage", effectif: 3, meteo: "Pluie" });
    expect(a.status, a.text).toBe(201);
    const b = await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-29", travaux: "Montage echafaudage, bache posee", effectif: 4, incidents: "Livraison en retard" });
    expect(b.status).toBe(201);
    expect(b.body.note.id).toBe(a.body.note.id);
    const notes = await db.select().from(journalChantierTable).where(eq(journalChantierTable.projetId, projetId));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ effectif: 4, incidents: "Livraison en retard", redigePar: ids.admin });
  });

  it("refuse une date qui n'existe pas et une note sans travaux", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const d = await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-02-31", travaux: "X" });
    expect(d.status).toBe(400);
    expect(d.body.code).toBe("jour_invalide");
    const t = await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-29", travaux: "   " });
    expect(t.status).toBe(400);
    expect(t.body.code).toBe("travaux_manquants");
  });

  it("un effectif non saisi reste nul — pas zero, qui voudrait dire « personne »", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const r = await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-28", travaux: "Nettoyage" });
    expect(r.body.note.effectif).toBeNull();
  });

  it("n'ecrit pas dans le journal du chantier d'une autre organisation", async () => {
    const autre = await unChantierDepuisDevis("1.00", ids.orgB);
    const r = await request(appli()).post(`/api/projets/${autre.projetId}/journal`).send({ jour: "2026-09-29", travaux: "Intrusion" });
    expect(r.status).toBe(404);
    const notes = await db.select().from(journalChantierTable).where(eq(journalChantierTable.projetId, autre.projetId));
    expect(notes).toHaveLength(0);
  });

  it("une photo rattachee a une note est comptee sur la note", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const n = await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-27", travaux: "Depose" });
    const [doc] = await db.insert(documentsTable).values({ organisationId: ids.orgA, fileName: "f.jpg", originalName: "fissure.jpg", mimeType: "image/jpeg", fileSize: 10 }).returning();
    const r = await request(appli()).post(`/api/projets/${projetId}/documents/${doc!.id}`).send({ journalId: n.body.note.id });
    expect(r.status, r.text).toBe(200);
    expect(r.body.document).toMatchObject({ entityType: "journal_chantier", entityId: n.body.note.id });
    const d = await request(appli()).get(`/api/projets/${projetId}/dossier`);
    expect(d.body.onglets.gunluk.find((x: any) => x.id === n.body.note.id).fotoAdedi).toBe(1);
  });
});

describe("rien ne traverse les organisations", () => {
  it("les montants d'un chantier etranger sont null, pas vides", async () => {
    const autre = await unChantierDepuisDevis("5000.00", ids.orgB);
    expect(await montantsDuChantier(ids.orgA, autre.projetId)).toBeNull();
  });

  it("on n'ouvre pas d'avenant sur le chantier d'une autre organisation", async () => {
    const autre = await unChantierDepuisDevis("5000.00", ids.orgB);
    const r = await request(appli()).post(`/api/projets/${autre.projetId}/avenant`).send({ title: "X", motif: "Y", items: [ligne] });
    expect(r.status).toBe(404);
    expect(await db.select().from(avenantsTable).where(eq(avenantsTable.projetId, autre.projetId))).toHaveLength(0);
  });

  it("une depense de l'organisation B rattachee (en base) au chantier de A n'entre pas dans ses montants", async () => {
    const { projetId } = await unChantierDepuisDevis();
    // La FK ne connait pas les organisations : on ecrit directement la ligne
    // qu'aucune route ne laisse passer, pour prouver que la LECTURE filtre aussi.
    await uneDepense(projetId, "99999.00", "approuve", ids.orgB);
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.gider.toplam).toBe(0);
    expect(m.asim).toBe(false);
  });
});


describe("les gardes relevees par la revue fichier par fichier", () => {
  it("un avenant dans une autre devise que le chantier est refuse", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "X", motif: "Y", currency: "USD", items: [ligne] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devise_differente");
  });

  it("un devis d une autre devise ne se rattache pas comme avenant", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const usd = await unDevis({ currency: "USD" });
    const r = await request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: usd.id, motif: "M" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devise_differente");
  });

  it("une note entree au journal ne se reecrit pas par une autre personne", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const [autre] = await db.insert(usersTable).values({ organisationId: ids.orgA, email: `autre-${stamp}-${++seq}@exemple.test`, passwordHash: "x", prenom: "Bob", nom: "B", role: "agent", actif: true }).returning({ id: usersTable.id });
    await request(appli()).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-26", travaux: "Recit original" });
    const r = await request(appli(ids.orgA, "agent", autre!.id)).post(`/api/projets/${projetId}/journal`).send({ jour: "2026-09-26", travaux: "Autre version" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("note_verrouillee");
    const [n] = await db.select().from(journalChantierTable).where(and(eq(journalChantierTable.projetId, projetId), eq(journalChantierTable.jour, "2026-09-26")));
    expect(n!.travaux).toBe("Recit original");
  });

  it("un document rattache ailleurs ne change pas de proprietaire en silence", async () => {
    const { projetId } = await unChantierDepuisDevis();
    const [doc] = await db.insert(documentsTable).values({ organisationId: ids.orgA, fileName: "c.pdf", originalName: "contrat.pdf", mimeType: "application/pdf", fileSize: 5, entityType: "contact", entityId: 42 }).returning();
    const r = await request(appli()).post(`/api/projets/${projetId}/documents/${doc!.id}`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("document_deja_rattache");
    const ok = await request(appli()).post(`/api/projets/${projetId}/documents/${doc!.id}`).send({ remplacer: true });
    expect(ok.status).toBe(200);
  });

  it("PATCH d une facture de devis vers un autre chantier est refuse", async () => {
    const c1 = await unChantierDepuisDevis();
    const c2 = await unChantierDepuisDevis();
    const conv = await request(appli()).post(`/api/devis/${c1.devis.id}/convert-to-facture`).send({});
    const r = await request(appli()).patch(`/api/factures-client/${conv.body.facture.id}`).send({ projetId: c2.projetId });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("chantier_different_du_devis");
  });

  it("une depense d une autre organisation rattachee au chantier n entre ni dans la comparaison ni dans Aujourd hui", async () => {
    const { projetId } = await unChantierDepuisDevis("1000.00");
    await uneDepense(projetId, "5000.00", "approuve", ids.orgB);
    const r = await request(appli()).get("/api/finance/affaires");
    expect(r.body.lignes.find((x: any) => x.id === projetId).gider).toBe(0);
    const masa = await construireMasaBugun(ids.orgA, new Date());
    expect(masa.finans.satirlar.find((s) => s.cle === `butce_asimi:${projetId}`)).toBeUndefined();
  });
});

// Nettoyage des encaissements du jeu : impossible par DELETE (journal
// inalterable) — on verifie seulement qu'on n'a rien ecrit hors de A.
describe("le jeu de test lui-meme", () => {
  it("n'a ecrit aucun encaissement dans l'organisation B", async () => {
    const lignes = await db.select().from(encaissementsTable).where(inArray(encaissementsTable.organisationId, [ids.orgB]));
    expect(lignes).toHaveLength(0);
  });
});
