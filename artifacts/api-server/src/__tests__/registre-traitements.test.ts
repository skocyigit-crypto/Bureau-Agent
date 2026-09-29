/**
 * Le registre des activites de traitement (art. 30) est tenu par le code,
 * rattache au schema, et ne dit appliquee aucune duree que rien n'applique.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { db, organisationsTable, contactsTable, auditLogsTable } from "@workspace/db";
import { TENANT_TABLES, EXCLUDED_TABLES } from "../services/tenant-backup";
import { ACTIVITE_DES_TABLES, activites, registre } from "../services/registre-traitements";
import { DESTIN_DES_TABLES } from "../services/purge-fin-contrat";
import { SECURITY_SCAN_RETENTION_DAYS } from "../services/security-scans";
import { RETENTION_DAYS as GEOLOC } from "../services/location-cleanup-cron";
import dataProtectionRouter from "../routes/data-protection";

const ligne = (id: string) => registre().find((l) => l.id === id)!;
const modeAvant = process.env.PURGE_FIN_CONTRAT;
afterEach(() => { if (modeAvant === undefined) delete process.env.PURGE_FIN_CONTRAT; else process.env.PURGE_FIN_CONTRAT = modeAvant; });

describe("chaque table est rattachee a une activite", () => {
  it("toutes les tables de locataire, et elles seules", () => {
    expect(Object.keys(ACTIVITE_DES_TABLES).sort()).toEqual([...TENANT_TABLES, ...Object.keys(EXCLUDED_TABLES)].sort());
  });
  it("chaque activite couvre au moins une table", () => {
    for (const l of registre()) expect(l.tables.length, l.id).toBeGreaterThan(0);
  });
  it("chaque activite remplit les rubriques de l'article 30", () => {
    for (const [id, a] of Object.entries(activites())) {
      for (const champ of ["nom", "finalite", "personnes", "donnees", "baseLegale", "dureeAnnoncee", "destinataires"] as const) {
        expect(a[champ].length, `${id}.${champ}`).toBeGreaterThan(3);
      }
    }
  });
  it("les traitements sensibles sont signales", () => {
    for (const id of ["geolocalisation", "evaluation_salaries", "reconnaissance_faciale"]) expect(ligne(id).sensible, id).toBe(true);
  });
  it("la reconnaissance faciale est declaree desactivee, avec ses gabarits residuels", () => {
    expect(ligne("reconnaissance_faciale").statut).toMatch(/Desactivee/);
    expect(ligne("reconnaissance_faciale").statut).toMatch(/gabarits/);
  });
  it("l'evaluation des salaries ne repose pas sur le consentement", () => {
    expect(ligne("evaluation_salaries").baseLegale).not.toMatch(/consentement/i);
    expect(ligne("evaluation_salaries").baseLegale).toMatch(/L2312-38/);
  });
});

describe("appliquee = ce que la plateforme efface vraiment", () => {
  it("une activite dont toutes les tables sont effacees en fin de contrat le dit", () => {
    expect(ligne("relation_client").appliquee).toMatch(/30 jours apres la fin du contrat/);
  });
  it("une activite en partie conservee nomme les tables effacees, pas les autres", () => {
    const a = ligne("comptes").appliquee!;
    expect(a).toMatch(/pour : /);
    expect(a.split("pour : ")[1]).not.toMatch(/\busers\b/);
  });
  it("les pieces comptables conservees ne sont jamais dites effacees", () => {
    // La facturation est en partie effacee (devis, raccordements) : le
    // registre le dit — mais aucune piece a garder 10 ans ne figure dans la liste.
    const effacees = ligne("facturation").appliquee!.split("pour : ")[1] ?? "";
    expect(effacees).not.toMatch(/factures_client|encaissements|compte_client|clotures_comptables|invoice_sequences/);
    expect(ligne("facturation").appliquee).toMatch(/Conservees 10 ans/);
  });
  it("chaque effacement affirme cite le fichier qui l'applique", () => {
    for (const l of registre()) if (l.appliquee) expect(l.appliquee, l.id).toMatch(/services\/[\w-]+\.ts/);
  });
  it("tant que la purge est en simulation, le registre le dit", () => {
    delete process.env.PURGE_FIN_CONTRAT;
    expect(ligne("relation_client").appliquee).toMatch(/en cours d'activation/);
    process.env.PURGE_FIN_CONTRAT = "effacer";
    expect(ligne("relation_client").appliquee).not.toMatch(/en cours d'activation/);
  });
  it("les durees citees sont celles des constantes qui les appliquent", () => {
    expect(ligne("geolocalisation").dureeAnnoncee).toBe(`${GEOLOC} jours`);
    expect(ligne("securite").dureeAnnoncee).toContain(`${SECURITY_SCAN_RETENTION_DAYS} jours`);
  });
  it("le registre et la purge ne se contredisent pas : chaque table effacee l'est dans les deux", () => {
    for (const l of registre()) {
      const effacees = l.tables.filter((t) => DESTIN_DES_TABLES[t as keyof typeof DESTIN_DES_TABLES] === "effacer");
      if (effacees.length > 0) expect(l.appliquee, l.id).toMatch(/fin du contrat/);
      else expect(l.appliquee ?? "", l.id).not.toMatch(/apres la fin du contrat \(DPA/);
    }
  });
});

describe("routes (base reelle)", () => {
  const stamp = Date.now();
  let orgId = 0;
  function app(role: string) {
    const a = express();
    a.use(express.json());
    a.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).session = { userId: 1, organisationId: orgId, userRole: role, userEmail: "r@x.test" };
      (req as any).log = { info() {}, warn() {}, error() {} };
      next();
    });
    a.use("/api", dataProtectionRouter);
    return a;
  }
  beforeAll(async () => {
    const [o] = await db.insert(organisationsTable).values({ name: `Registre ${stamp}`, slug: `registre-${stamp}`, maxUsers: 3, actif: true }).returning({ id: organisationsTable.id });
    orgId = o!.id;
    await db.insert(contactsTable).values([
      { organisationId: orgId, firstName: "A", lastName: "Un", phone: "01" },
      { organisationId: orgId, firstName: "B", lastName: "Deux", phone: "02" },
    ]);
  }, 60_000);
  afterAll(async () => { try { await db.delete(contactsTable).where(eq(contactsTable.organisationId, orgId)); } catch { /* base jetable */ } });

  it("le registre compte les enregistrements reels de l'organisation", async () => {
    const r = await request(app("administrateur")).get("/api/data-protection/registre");
    expect(r.status).toBe(200);
    expect(r.body.activites.find((a: { id: string }) => a.id === "relation_client").enregistrements).toBe(2);
  });
  it("il est reserve au responsable", async () => {
    expect((await request(app("agent")).get("/api/data-protection/registre")).status).toBe(403);
  });
  it("le CSV se telecharge, et son extraction est tracee", async () => {
    const r = await request(app("administrateur")).get("/api/data-protection/registre/csv");
    expect(r.status).toBe(200);
    expect(r.text).toContain("Relation client et messagerie");
    const traces = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.organisationId, orgId), eq(auditLogsTable.resource, "registre_traitements")));
    expect(traces).toHaveLength(1);
  });
  it("le registre IA liste les systemes, sans l'infrastructure", async () => {
    const r = await request(app("administrateur")).get("/api/data-protection/registre-ia");
    expect(r.status).toBe(200);
    const ids = r.body.systemes.map((s: { id: string }) => s.id);
    expect(ids).toContain("secretaire_telephonique");
    expect(ids).not.toContain("infrastructure");
    expect(r.body.exclusionsExaminees.length).toBeGreaterThan(0);
  });
});
