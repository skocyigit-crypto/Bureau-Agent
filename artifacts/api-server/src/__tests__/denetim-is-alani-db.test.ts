/**
 * Les constats confirmes de la revue du 30/09 par domaine metier (8 domaines,
 * 5 lentilles + 3 contradicteurs par constat, 43 constats confirmes, 14
 * defauts distincts). Un test par defaut, sur une vraie base, avec les vrais
 * routeurs. Chaque test decrit le scenario qui cassait.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  auditLogsTable, avenantsTable, db, depensesTable, devisTable, documentsTable, facturesClientTable,
  journalChantierTable, organisationsTable, projetsTable, usersTable,
} from "@workspace/db";
import chantierRouter from "../routes/chantier";
import devisRouter from "../routes/devis";
import facturesClientRouter from "../routes/factures-client";
import depensesRouter from "../routes/depenses";
import projetsRouter from "../routes/projets";
import documentsRouter from "../routes/documents";
import { enregistrerEncaissement } from "../services/encaissement-enregistrement";
import { montantsDuChantier } from "../services/dossier-chantier";
import { RESTORABLE_TABLES } from "../services/tenant-restore";
import { typeEntiteDocument } from "../services/appartenance";

const stamp = Date.now();
const ids: Record<string, number> = {};
const JOUR = 86400000;
let seq = 0;
const ref = (p: string) => `${p}-${stamp}-${++seq}`;
const ligne = { description: "Travaux", quantity: 1, unitPrice: 1000, taxRate: 20, total: 1000 };

function appli(role = "administrateur", userId = ids.admin, orgId = ids.orgA) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role, role, userEmail: `x-${stamp}@exemple.test` };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  for (const r of [chantierRouter, devisRouter, facturesClientRouter, depensesRouter, projetsRouter, documentsRouter]) a.use("/api", r);
  return a;
}

async function unDevis(v: Record<string, unknown> = {}, orgId = ids.orgA) {
  const [d] = await db.insert(devisTable).values({
    organisationId: orgId, reference: ref("DV"), title: "Ravalement", clientName: "SCI Duval", items: [],
    subtotal: "1000.00", taxAmount: "200.00", totalAmount: "1200.00", status: "accepte",
    acceptedAt: new Date(), validUntil: new Date(Date.now() + 30 * JOUR), ...v,
  } as any).returning();
  return d!;
}
async function unChantier(orgId = ids.orgA) {
  const d = await unDevis({}, orgId);
  const r = await request(appli("administrateur", orgId === ids.orgA ? ids.admin : ids.adminB, orgId)).post(`/api/devis/${d.id}/chantier`).send({});
  expect(r.status, r.text).toBe(201);
  return { devis: d, projetId: r.body.projet.id as number };
}

beforeAll(async () => {
  for (const k of ["orgA", "orgB"]) {
    const [o] = await db.insert(organisationsTable).values({ name: `Revue ${k} ${stamp}`, slug: `rev-${k.toLowerCase()}-${stamp}`, maxUsers: 9, actif: true }).returning({ id: organisationsTable.id });
    ids[k] = o!.id;
  }
  const mk = async (org: number, role: string, n: string) => (await db.insert(usersTable).values({ organisationId: org, email: `${n}-${stamp}@exemple.test`, passwordHash: "x", prenom: n, nom: "T", role, actif: true }).returning({ id: usersTable.id }))[0]!.id;
  ids.admin = await mk(ids.orgA, "administrateur", "adm");
  ids.agent = await mk(ids.orgA, "agent", "agt");
  ids.lecteur = await mk(ids.orgA, "lecture_seule", "lec");
  ids.adminB = await mk(ids.orgB, "administrateur", "admb");
});

afterAll(async () => { /* base de test jetable : journal d'encaissements inalterable */ });

describe("un devis n'a qu'une affectation", () => {
  it("un devis deja avenant n'ouvre pas son propre chantier (le montant compterait deux fois)", async () => {
    const { projetId } = await unChantier();
    const libre = await unDevis({ totalAmount: "700.00" });
    expect((await request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "Sup" })).status).toBe(201);
    const r = await request(appli()).post(`/api/devis/${libre.id}/chantier`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_est_avenant");
    expect(await db.select().from(projetsTable).where(eq(projetsTable.devisId, libre.id))).toHaveLength(0);
  });

  it("ouvrir le chantier et rattacher le meme devis en meme temps : une seule affectation", async () => {
    const { projetId } = await unChantier();
    for (let i = 0; i < 5; i++) {
      const libre = await unDevis({ totalAmount: "300.00" });
      await Promise.all([
        request(appli()).post(`/api/devis/${libre.id}/chantier`).send({}),
        request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: libre.id, motif: "M" }),
      ]);
      const marches = await db.select().from(projetsTable).where(eq(projetsTable.devisId, libre.id));
      const avenants = await db.select().from(avenantsTable).where(eq(avenantsTable.devisId, libre.id));
      expect(marches.length + avenants.length, `essai ${i}`).toBe(1);
    }
  });

  it("une facture emise AVANT l'ouverture du chantier le rejoint a l'ouverture", async () => {
    const d = await unDevis();
    const conv = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    expect(conv.body.facture.projetId).toBeNull();
    const r = await request(appli()).post(`/api/devis/${d.id}/chantier`).send({});
    const [f] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, conv.body.facture.id));
    expect(f!.projetId).toBe(r.body.projet.id);
  });

  it("une facture emise avant le rattachement d'un avenant rejoint le chantier de l'avenant", async () => {
    const { projetId } = await unChantier();
    const d = await unDevis({ totalAmount: "500.00" });
    const conv = await request(appli()).post(`/api/devis/${d.id}/convert-to-facture`).send({});
    await request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: d.id, motif: "M" });
    const [f] = await db.select().from(facturesClientTable).where(eq(facturesClientTable.id, conv.body.facture.id));
    expect(f!.projetId).toBe(projetId);
  });
});

describe("ce qui engage ne se defait pas en silence", () => {
  it("un devis accepte ne se supprime pas", async () => {
    const d = await unDevis();
    const r = await request(appli()).delete(`/api/devis/${d.id}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devis_engage");
    expect(await db.select().from(devisTable).where(eq(devisTable.id, d.id))).toHaveLength(1);
  });

  it("un devis brouillon rattache comme avenant ne se supprime pas non plus", async () => {
    const { projetId } = await unChantier();
    const av = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "X", motif: "Y", items: [ligne] });
    const r = await request(appli()).delete(`/api/devis/${av.body.devis.id}`);
    expect(r.status).toBe(409);
    expect(await db.select().from(avenantsTable).where(eq(avenantsTable.id, av.body.avenant.id))).toHaveLength(1);
  });

  it("un devis brouillon libre se supprime toujours", async () => {
    const d = await unDevis({ status: "brouillon", acceptedAt: null });
    expect((await request(appli()).delete(`/api/devis/${d.id}`)).status).toBe(200);
  });

  it("un agent ne revient pas sur une acceptation ; un administrateur oui, avec trace", async () => {
    const d = await unDevis();
    const a = await request(appli("agent", ids.agent)).patch(`/api/devis/${d.id}`).send({ status: "brouillon" });
    expect(a.status).toBe(403);
    expect(a.body.code).toBe("retrait_acceptation_reserve");
    expect((await db.select().from(devisTable).where(eq(devisTable.id, d.id)))[0]!.status).toBe("accepte");
    const b = await request(appli()).patch(`/api/devis/${d.id}`).send({ status: "refuse" });
    expect(b.status, b.text).toBe(200);
    const t = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.action, "devis.acceptation_retiree"), eq(auditLogsTable.resourceId, String(d.id))));
    expect(t).toHaveLength(1);
  });

  it("un agent ne rattache pas un devis deja accepte, ni ne detache un avenant accepte", async () => {
    const { projetId } = await unChantier();
    const acc = await unDevis({ totalAmount: "400.00" });
    const r1 = await request(appli("agent", ids.agent)).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: acc.id, motif: "M" });
    expect(r1.status).toBe(403);
    const ok = await request(appli()).post(`/api/projets/${projetId}/avenant/rattacher`).send({ devisId: acc.id, motif: "M" });
    const r2 = await request(appli("agent", ids.agent)).delete(`/api/avenants/${ok.body.avenant.id}`);
    expect(r2.status).toBe(403);
    expect((await montantsDuChantier(ids.orgA, projetId))!.ekIsler.toplam).toBe(400);
  });

  it("un agent ouvre toujours un avenant en brouillon (il ne compte pas)", async () => {
    const { projetId } = await unChantier();
    const r = await request(appli("agent", ids.agent)).post(`/api/projets/${projetId}/avenant`).send({ title: "X", motif: "Y", items: [ligne] });
    expect(r.status, r.text).toBe(201);
  });

  it("un chantier qui porte des enregistrements ne se supprime pas ; un chantier vide oui", async () => {
    const { projetId } = await unChantier();
    const r = await request(appli()).delete(`/api/projets/${projetId}`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("chantier_non_vide");
    const [vide] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Vide" }).returning();
    expect((await request(appli()).delete(`/api/projets/${vide!.id}`)).status).toBe(204);
  });

  it("un chantier avec seulement une note de journal ne se supprime pas", async () => {
    const [p] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Avec journal" }).returning();
    await request(appli()).post(`/api/projets/${p!.id}/journal`).send({ jour: "2026-09-20", travaux: "Constat" });
    expect((await request(appli()).delete(`/api/projets/${p!.id}`)).status).toBe(409);
  });
});

describe("une seule devise par chantier", () => {
  it("une facture en USD ne se rattache pas a un chantier en EUR (creation)", async () => {
    const { projetId } = await unChantier();
    const r = await request(appli()).post("/api/factures-client").send({ title: "F", clientName: "C", currency: "USD", projetId, items: [ligne] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devise_differente");
  });

  it("une facture du chantier ne change pas de devise (modification)", async () => {
    const { projetId } = await unChantier();
    const c = await request(appli()).post("/api/factures-client").send({ title: "F", clientName: "C", projetId, items: [ligne] });
    expect(c.status, c.text).toBe(201);
    const r = await request(appli()).patch(`/api/factures-client/${c.body.id}`).send({ currency: "GBP" });
    expect(r.status).toBe(409);
  });

  it("une depense ne se rattache pas a un chantier en USD", async () => {
    const [usd] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "USD", currency: "USD" }).returning();
    const r = await request(appli()).post("/api/depenses").send({ vendor: "V", amountTtc: 100, projetId: usd!.id });
    expect(r.status).toBe(409);
  });

  it("la devise d'un avenant brouillon ne peut pas diverger de celle du chantier", async () => {
    const { projetId } = await unChantier();
    const av = await request(appli()).post(`/api/projets/${projetId}/avenant`).send({ title: "X", motif: "Y", items: [ligne] });
    const r = await request(appli()).patch(`/api/devis/${av.body.devis.id}`).send({ currency: "USD" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("devise_differente");
  });
});

describe("l'argent recu compte, quel que soit le statut de la facture", () => {
  it("un reglement sur une facture restee en brouillon entre dans l'encaisse du chantier", async () => {
    const { projetId } = await unChantier();
    const [f] = await db.insert(facturesClientTable).values({ organisationId: ids.orgA, projetId, reference: ref("FC"), title: "Acompte", clientName: "C", subtotal: "1000", taxAmount: "0", totalAmount: "1000", status: "brouillon" } as any).returning();
    expect((await enregistrerEncaissement({ organisationId: ids.orgA, factureId: f!.id, montantCentimes: 30000, moyen: "virement" })).ok).toBe(true);
    const m = (await montantsDuChantier(ids.orgA, projetId))!;
    expect(m.tahsilEdilen.toplam).toBe(300);
    const cmp = await request(appli()).get("/api/finance/affaires");
    expect(cmp.body.lignes.find((l: any) => l.id === projetId).tahsilEdilen).toBe(300);
  });
});

describe("documents et journal", () => {
  it("l'orthographe « project » devient « projet »", () => {
    expect(typeEntiteDocument("project")).toBe("projet");
    expect(typeEntiteDocument("Chantier")).toBe("projet");
    expect(typeEntiteDocument("facture")).toBe("facture");
    expect(typeEntiteDocument("")).toBeNull();
  });

  it("PUT /documents/:id ne rattache pas a la note de journal d'une autre organisation", async () => {
    const autre = await unChantier(ids.orgB);
    const n = await request(appli("administrateur", ids.adminB, ids.orgB)).post(`/api/projets/${autre.projetId}/journal`).send({ jour: "2026-09-21", travaux: "B" });
    const [doc] = await db.insert(documentsTable).values({ organisationId: ids.orgA, fileName: "a.jpg", originalName: "a.jpg", mimeType: "image/jpeg", fileSize: 3 }).returning();
    const r = await request(appli()).put(`/api/documents/${doc!.id}`).send({ entityType: "journal_chantier", entityId: n.body.note.id });
    expect(r.status).toBe(400);
    const d = await request(appli("administrateur", ids.adminB, ids.orgB)).get(`/api/projets/${autre.projetId}/dossier`);
    expect(d.body.onglets.gunluk[0].fotoAdedi).toBe(0);
  });

  it("PUT /documents/:id range « project » sous « projet », et le dossier le montre", async () => {
    const { projetId } = await unChantier();
    const [doc] = await db.insert(documentsTable).values({ organisationId: ids.orgA, fileName: "p.pdf", originalName: "plan.pdf", mimeType: "application/pdf", fileSize: 3 }).returning();
    const r = await request(appli()).put(`/api/documents/${doc!.id}`).send({ entityType: "project", entityId: projetId });
    expect(r.status, r.text).toBe(200);
    expect(r.body.document.entityType).toBe("projet");
    const d = await request(appli()).get(`/api/projets/${projetId}/dossier`);
    expect(d.body.onglets.belgeler.map((b: any) => b.id)).toContain(doc!.id);
  });

  it("une photo du journal d'un AUTRE chantier ne se deplace pas sans « remplacer »", async () => {
    const c1 = await unChantier();
    const c2 = await unChantier();
    const n = await request(appli()).post(`/api/projets/${c1.projetId}/journal`).send({ jour: "2026-09-22", travaux: "X" });
    const [doc] = await db.insert(documentsTable).values({ organisationId: ids.orgA, fileName: "f.jpg", originalName: "f.jpg", mimeType: "image/jpeg", fileSize: 3, entityType: "journal_chantier", entityId: n.body.note.id }).returning();
    const r = await request(appli()).post(`/api/projets/${c2.projetId}/documents/${doc!.id}`).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("document_deja_rattache");
  });

  it("un compte en lecture seule ne voit pas la liste des documents par le dossier", async () => {
    const { projetId } = await unChantier();
    await db.insert(documentsTable).values({ organisationId: ids.orgA, fileName: "s.pdf", originalName: "secret.pdf", mimeType: "application/pdf", fileSize: 3, entityType: "projet", entityId: projetId });
    const lec = await request(appli("lecture_seule", ids.lecteur)).get(`/api/projets/${projetId}/dossier`);
    expect(lec.status).toBe(200);
    expect(lec.body.onglets.belgeler).toEqual([]);
    const adm = await request(appli()).get(`/api/projets/${projetId}/dossier`);
    expect(adm.body.onglets.belgeler.length).toBe(1);
  });

  it("deux auteurs qui ecrivent le meme jour en meme temps : la note ENTREE n'est jamais ecrasee", async () => {
    const [p] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: "Course" }).returning();
    await request(appli()).post(`/api/projets/${p!.id}/journal`).send({ jour: "2026-09-23", travaux: "Recit de l'admin" });
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      request(appli("agent", ids.agent)).post(`/api/projets/${p!.id}/journal`).send({ jour: "2026-09-23", travaux: `Tentative ${i}` })));
    expect(rs.every((r) => r.status === 409)).toBe(true);
    const [n] = await db.select().from(journalChantierTable).where(and(eq(journalChantierTable.projetId, p!.id), eq(journalChantierTable.jour, "2026-09-23")));
    expect(n!.travaux).toBe("Recit de l'admin");
  });
});

describe("le verrou du journal tient dans la course (pas seulement a la verification)", () => {
  it("deux auteurs ecrivent la PREMIERE note du jour au meme instant : un seul recit l'emporte", async () => {
    // La pre-verification lit « aucune note » pour les deux : c'est la
    // condition DANS l'ecriture (setWhere) qui doit refuser le second.
    let courses = 0;
    for (let i = 0; i < 12; i++) {
      const [p] = await db.insert(projetsTable).values({ organisationId: ids.orgA, title: `Course ${i}` }).returning();
      const [a, b] = await Promise.all([
        request(appli()).post(`/api/projets/${p!.id}/journal`).send({ jour: "2026-09-24", travaux: "Version admin" }),
        request(appli("agent", ids.agent)).post(`/api/projets/${p!.id}/journal`).send({ jour: "2026-09-24", travaux: "Version agent" }),
      ]);
      const gagnants = [a, b].filter((r) => r.status === 201);
      expect(gagnants, `essai ${i} : ${a.status}/${b.status}`).toHaveLength(1);
      const [n] = await db.select().from(journalChantierTable).where(eq(journalChantierTable.projetId, p!.id));
      // Le recit enregistre est celui de la requete qui a recu 201.
      expect(n!.travaux).toBe(gagnants[0]!.body.note.travaux);
      if (a.status === 409 || b.status === 409) courses++;
    }
    expect(courses).toBe(12);
  });
});

describe("liens et listes", () => {
  it("au-dela de 200 chantiers, la comparaison dit le vrai total et qu'elle est tronquee", async () => {
    const [o] = await db.insert(organisationsTable).values({ name: `Grande ${stamp}`, slug: `grande-${stamp}`, maxUsers: 3, actif: true }).returning({ id: organisationsTable.id });
    await db.insert(projetsTable).values(Array.from({ length: 205 }, (_, i) => ({ organisationId: o!.id, title: `C${i}` })));
    const r = await request(appli("administrateur", ids.admin, o!.id)).get("/api/finance/affaires");
    expect(r.status).toBe(200);
    expect(r.body.lignes).toHaveLength(200);
    expect(r.body.adet).toBe(205);
    expect(r.body.fazlasi).toBe(true);
  });

  it("GET /depenses/:id lit une depense de l'organisation, et rien d'une autre", async () => {
    const [d] = await db.insert(depensesTable).values({ organisationId: ids.orgA, vendor: "V", amountTtc: "10", status: "approuve", source: "manuel" } as any).returning();
    const ok = await request(appli()).get(`/api/depenses/${d!.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(d!.id);
    const ko = await request(appli("administrateur", ids.adminB, ids.orgB)).get(`/api/depenses/${d!.id}`);
    expect(ko.status).toBe(404);
    // Les routes nommees passent toujours.
    expect((await request(appli()).get("/api/depenses/stats")).status).toBe(200);
  });

  it("la comparaison dit le nombre reel de chantiers et qu'elle est tronquee", async () => {
    const r = await request(appli()).get("/api/finance/affaires");
    const [{ n }] = (await db.execute(`select count(*)::int as n from projets where organisation_id = ${ids.orgA}` as any)).rows as any;
    expect(r.body.adet).toBe(Number(n));
    expect(r.body.fazlasi).toBe(Number(n) > r.body.lignes.length);
  });
});

describe("la restauration suit les cles etrangeres", () => {
  it("chaque table restaurable vient APRES les tables restaurables qu'elle reference (lu dans la base)", async () => {
    const res = await db.execute(`
      select tc.table_name as enfant, ccu.table_name as parent
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'` as any);
    const ordre = RESTORABLE_TABLES as readonly string[];
    const fautes: string[] = [];
    for (const { enfant, parent } of res.rows as Array<{ enfant: string; parent: string }>) {
      if (enfant === parent) continue;
      const ie = ordre.indexOf(enfant), ip = ordre.indexOf(parent);
      if (ie >= 0 && ip >= 0 && ip > ie) fautes.push(`${enfant} avant ${parent}`);
    }
    expect(fautes).toEqual([]);
  });
});
