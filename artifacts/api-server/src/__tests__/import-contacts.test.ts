/**
 * Import CSV de contacts (base reelle, vrai routeur, lignes telles que les
 * produit lecture-csv a partir d'un export Excel francais).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { contactsTable, db, organisationsTable } from "@workspace/db";
import router from "../routes/contacts";
import { cleTelephone, lireLigneContact } from "../services/import-contacts";

const stamp = Date.now();
let orgId = 0, autreOrg = 0;

function appli(org = () => orgId) {
  const a = express();
  a.use(express.json({ limit: "5mb" }));
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId: null, organisationId: org(), userRole: "agent" }; (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } }; next(); });
  a.use("/api", router);
  return a;
}
const importer = (rows: unknown[], org?: () => number) => request(appli(org)).post("/api/contacts/import").send({ rows });
const carnet = async (o = orgId) => db.select().from(contactsTable).where(eq(contactsTable.organisationId, o));

async function org(n: string) {
  const [o] = await db.insert(organisationsTable).values({ name: `Imp ${n} ${stamp}`, slug: `imp-${n}-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  return o!.id;
}
beforeAll(async () => { orgId = await org("a"); autreOrg = await org("b"); }, 60_000);
afterAll(async () => {
  for (const o of [orgId, autreOrg]) { await db.delete(contactsTable).where(eq(contactsTable.organisationId, o)); await db.delete(organisationsTable).where(eq(organisationsTable.id, o)); }
});

describe("lecture d'une ligne", () => {
  it("06 et +33 6 donnent la meme cle", () => {
    expect(cleTelephone("06 12 34 56 78")).toBe(cleTelephone("+33 6 12 34 56 78"));
  });
  it("categorie accentuee et en capitales reconnue", () => {
    const l = lireLigneContact({ Prénom: "A", Nom: "B", Téléphone: "0611111111", Catégorie: "FOURNISSEUR" });
    expect(l.ok && l.valeurs.category).toBe("fournisseur");
  });
  it("categorie inconnue -> autre, avec avertissement", () => {
    const l = lireLigneContact({ Prénom: "A", Nom: "B", Téléphone: "0611111111", Catégorie: "VIP" });
    expect(l.ok && [l.valeurs.category, l.avertissements.length]).toEqual(["autre", 1]);
  });
  it("email invalide ignore, contact garde", () => {
    const l = lireLigneContact({ Prénom: "A", Nom: "B", Téléphone: "0611111111", Email: "pas-un-mail" });
    expect(l.ok && l.valeurs.email).toBeNull();
  });
});

describe("POST /contacts/import", () => {
  it("ligne sans telephone : raison explicite, pas « doublon »", async () => {
    const r = await importer([{ Prénom: "Sans", Nom: "Numero", Email: "sans@example.test" }]);
    expect(r.body.imported).toBe(0);
    expect(r.body.errors[0]).toMatch(/téléphone manquant/);
  });

  it("importer deux fois le meme fichier ne double pas le carnet", async () => {
    const fichier = [
      { Prénom: "Jean", Nom: "Dupont", Téléphone: "0612345678", Email: "jean@example.test" },
      { Prénom: "Marie", Nom: "Martin", Téléphone: "0698765432" },
    ];
    expect((await importer(fichier)).body.imported).toBe(2);
    const second = await importer(fichier);
    expect([second.body.imported, second.body.skipped]).toEqual([0, 2]);
    expect(second.body.errors[0]).toMatch(/déjà présent/);
    expect((await carnet()).filter((c) => c.lastName === "Dupont").length).toBe(1);
  });

  it("meme numero ecrit autrement (+33) reconnu comme doublon", async () => {
    const r = await importer([{ Prénom: "Jean", Nom: "Dupont bis", Téléphone: "+33 6 12 34 56 78" }]);
    expect(r.body.imported).toBe(0);
  });

  it("doublon a l'interieur du fichier", async () => {
    const r = await importer([
      { Prénom: "Luc", Nom: "Petit", Téléphone: "0677777777" },
      { Prénom: "Luc", Nom: "Petit", Téléphone: "06 77 77 77 77" },
    ]);
    expect([r.body.imported, r.body.skipped]).toEqual([1, 1]);
  });

  it("le carnet d'une autre organisation ne bloque pas l'import", async () => {
    const r = await importer([{ Prénom: "Marie", Nom: "Martin", Téléphone: "0698765432" }], () => autreOrg);
    expect(r.body.imported).toBe(1);
  });

  it("categorie inconnue enregistree « autre »", async () => {
    await importer([{ Prénom: "Zoe", Nom: "Vip", Téléphone: "0655555555", Catégorie: "VIP" }]);
    expect((await carnet()).find((c) => c.lastName === "Vip")!.category).toBe("autre");
  });

  it("une ligne non objet ne fait pas echouer tout l'import", async () => {
    const r = await importer([null, "texte", { Prénom: "Ok", Nom: "Ligne", Téléphone: "0644444444" }]);
    expect(r.status).toBe(200);
    expect([r.body.imported, r.body.skipped]).toEqual([1, 2]);
  });

  it("plus de 500 lignes refusees", async () => {
    expect((await importer(Array.from({ length: 501 }, () => ({})))).status).toBe(400);
  });
});
