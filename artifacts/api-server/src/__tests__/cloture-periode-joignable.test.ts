/**
 * La cloture comptable etait injoignable : un antislash manquait.
 *
 * Les deux routes qui acceptent une periode — `POST /encaissements/cloturer`
 * et `GET /encaissements/archive` — la validaient par
 * `/^d{4}(-d{2}(-d{2})?)?$/`. Sans les antislashs, cette expression ne
 * reconnait plus des chiffres : elle reconnait les chaines litterales
 * « dddd », « dddd-dd » et « dddd-dd-dd ».
 *
 * Mesure du 18/09 : « 2026 », « 2026-09 » et « 2026-09-18 » etaient tous
 * refuses ; seul « dddd » passait. Autrement dit, AUCUNE periode reelle ne
 * pouvait etre close ni archivee.
 *
 * Ce n'est pas un detail de saisie. La cloture fige le cumul et scelle la
 * chaine : c'est la condition de conservation de l'article 286-I-3° bis du
 * CGI, et l'archive est ce qu'on remet a un controleur. Les deux fonctions
 * existaient, etaient testees dans leur logique pure (cloture-comptable,
 * archivage-comptable), et personne ne pouvait les atteindre par l'API — le
 * seul retour etant « Periode invalide », qui accusait l'utilisateur.
 *
 * Les controles ci-dessous passent donc par la ROUTE, seul endroit ou le
 * defaut se voyait.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, facturesClientTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/encaissements";

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

const clore = (corps: Record<string, unknown>) =>
  request(appli()).post("/api/encaissements/cloturer").send(corps);

const archiver = (q: string) =>
  request(appli()).get(`/api/encaissements/archive?${q}`);

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Cloture ${stamp}`, slug: `cloture-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `cloture-${stamp}@example.test`,
    passwordHash: "x", prenom: "C", nom: "L", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
  // Une facture reglee, pour que la periode ait un contenu a figer.
  const [f] = await db.insert(facturesClientTable).values({
    organisationId: orgId, reference: `CLO-${stamp}`, title: "Travaux", clientName: "Client",
    status: "envoyee", items: [], subtotal: "100.00", taxAmount: "20.00",
    totalAmount: "120.00", paidAmount: "0", currency: "EUR",
  } as any).returning({ id: facturesClientTable.id });
  await request(appli()).post("/api/encaissements").send({ factureId: f!.id, montant: 120, moyen: "virement" });
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

const anneeCourante = String(new Date().getFullYear());
const moisCourant = `${anneeCourante}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
const jourCourant = `${moisCourant}-${String(new Date().getDate()).padStart(2, "0")}`;

describe("une periode reelle est acceptee", () => {
  it("le jour du calendrier n'est plus refuse", async () => {
    const r = await clore({ type: "journaliere", periode: jourCourant });
    expect(r.status, `« ${jourCourant} » refuse: aucune periode reelle ne pouvait etre close`).not.toBe(400);
  });

  it("un mois est accepte par la validation", async () => {
    const r = await clore({ type: "mensuelle", periode: moisCourant });
    expect(String(r.body?.error ?? ""), `« ${moisCourant} » refuse`).not.toMatch(/Periode invalide/);
  });

  it("une annee aussi", async () => {
    const r = await clore({ type: "annuelle", periode: anneeCourante });
    expect(String(r.body?.error ?? "")).not.toMatch(/Periode invalide/);
  });

  it("l'archive comptable est joignable pour un mois", async () => {
    const r = await archiver(`type=mensuelle&periode=${moisCourant}`);
    expect(r.status, "l'archive remise a un controleur etait inatteignable").not.toBe(400);
  });

  it("l'archive accepte une annee", async () => {
    const r = await archiver(`type=annuelle&periode=${anneeCourante}`);
    expect(String(r.body?.error ?? "")).not.toMatch(/Periode invalide/);
  });
});

describe("ce qui doit rester refuse", () => {
  it("« dddd » n'est pas une periode", async () => {
    // C'etait la SEULE valeur que l'expression cassee acceptait.
    const r = await clore({ type: "annuelle", periode: "dddd" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Periode invalide/);
  });

  it("une periode vide est refusee", async () => {
    expect((await clore({ type: "annuelle", periode: "" })).status).toBe(400);
  });

  it("un format libre est refuse", async () => {
    for (const p of ["septembre 2026", "2026/09", "26-09", "2026-9"]) {
      expect((await clore({ type: "mensuelle", periode: p })).status, `« ${p} » accepte`).toBe(400);
    }
  });

  it("un type de periode inconnu est refuse", async () => {
    expect((await clore({ type: "hebdomadaire", periode: moisCourant })).status).toBe(400);
  });

  it("l'archive refuse elle aussi un format libre", async () => {
    expect((await archiver("type=annuelle&periode=deux-mille-vingt-six")).status).toBe(400);
  });
});

describe("l'expression elle-meme", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "routes", "encaissements.ts"), "utf8",
  );

  it("les deux validations reconnaissent des CHIFFRES", () => {
    const occurrences = source.match(/\^\\d\{4\}\(-\\d\{2\}\(-\\d\{2\}\)\?\)\?\$/g) ?? [];
    expect(occurrences.length, "un antislash manquant rend la route injoignable").toBe(2);
  });

  it("aucune validation de periode ne subsiste sans antislash", () => {
    expect(source, "expression litterale « dddd » encore presente").not.toMatch(/\^d\{4\}\(-d\{2\}/);
  });
});
