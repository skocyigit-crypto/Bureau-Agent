/**
 * « Ne plus relancer ce client » ne marchait pour personne.
 *
 * Le cron des relances de paiement contenait bien la garde :
 *
 *     .from(compteClientTable)
 *     .where(eq(compteClientTable.autoReminderEnabled, false))
 *
 * Mais RIEN n'a jamais rempli `compte_client` — la meme table dont l'audit du
 * 19/09 a montre qu'elle etait lue quinze fois et ecrite zero — et aucun ecran
 * ne proposait le reglage. La liste des exclus etait donc toujours vide : un
 * client qui avait demande qu'on cesse les relances automatiques en recevait
 * quand meme.
 *
 * Une garde qui ne garde rien est pire qu'une garde absente : on croit le sujet
 * traite, et personne ne le rouvre. Ces relances partent vers les CLIENTS de
 * l'organisation — un envoi non voulu est un incident commercial, pas un detail
 * d'affichage.
 *
 * Le reglage vit desormais sur le contact, et s'enregistre par la route dediee
 * au demarchage : une volonte exprimee par un client se consigne par un acte
 * explicite, pas au detour d'un changement d'adresse.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, contactsTable, organisationsTable, usersTable } from "@workspace/db";
import contactsRouter from "../routes/contacts";

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
  a.use("/api", contactsRouter);
  return a;
}

async function unContact(): Promise<number> {
  const [c] = await db.insert(contactsTable).values({
    organisationId: orgId, firstName: "Jean", lastName: `Client${Math.random().toString(36).slice(2, 7)}`,
    phone: "0102030405",
  } as any).returning({ id: contactsTable.id });
  return c!.id;
}

async function etat(id: number) {
  const [c] = await db.select({
    refuse: contactsTable.relancesAutoDesactivees,
    type: contactsTable.typePersonne,
  }).from(contactsTable).where(eq(contactsTable.id, id));
  return c!;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Relances ${stamp}`, slug: `relances-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `relances-${stamp}@example.test`,
    passwordHash: "x", prenom: "R", nom: "L", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId)); } catch { /* journaux */ }
});

describe("le refus s'enregistre, et sur le contact", () => {
  it("par defaut, un client est relancable", async () => {
    expect(await etat(await unContact())).toMatchObject({ refuse: false });
  });

  it("le refus est enregistre", async () => {
    const id = await unContact();
    const r = await request(appli()).patch(`/api/contacts/${id}/demarchage`).send({ relancesAuto: false });
    expect(r.status).toBe(200);
    expect((await etat(id)).refuse, "le reglage n'etait stocke nulle part").toBe(true);
  });

  it("il se retire", async () => {
    const id = await unContact();
    await request(appli()).patch(`/api/contacts/${id}/demarchage`).send({ relancesAuto: false });
    await request(appli()).patch(`/api/contacts/${id}/demarchage`).send({ relancesAuto: true });
    expect((await etat(id)).refuse).toBe(false);
  });

  it("il ne touche pas au reste de la fiche", async () => {
    const id = await unContact();
    await request(appli()).patch(`/api/contacts/${id}/demarchage`).send({ relancesAuto: false });
    expect((await etat(id)).type, "seul le champ envoye doit changer").toBe("inconnu");
  });

  it("une requete vide reste refusee", async () => {
    const id = await unContact();
    const r = await request(appli()).patch(`/api/contacts/${id}/demarchage`).send({});
    expect(r.status).toBe(400);
  });

  it("le contact d'une autre organisation n'est pas joignable", async () => {
    const [autre] = await db.insert(organisationsTable).values({
      name: `Autre ${stamp}`, slug: `autre-rel-${stamp}`, maxUsers: 5, actif: true,
    }).returning({ id: organisationsTable.id });
    const [c] = await db.insert(contactsTable).values({
      organisationId: autre!.id, firstName: "X", lastName: "Y", phone: "0600000000",
    } as any).returning({ id: contactsTable.id });
    const r = await request(appli()).patch(`/api/contacts/${c!.id}/demarchage`).send({ relancesAuto: false });
    expect(r.status, "le cloisonnement entre clients doit tenir ici aussi").toBe(404);
    try { await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id)); } catch { /* journaux */ }
  });
});

describe("le cron lit bien ce champ, et non la table morte", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "services", "payment-reminder.ts"), "utf8",
  );

  it("il n'interroge plus `compte_client`", () => {
    expect(
      source,
      "cette table n'est jamais ecrite: la liste des exclus etait toujours vide",
    ).not.toMatch(/compteClientTable/);
  });

  it("il lit le champ du contact", () => {
    expect(source).toMatch(/contactsTable\.relancesAutoDesactivees/);
  });

  it("et s'en sert pour exclure", () => {
    expect(source).toMatch(/optedOut\.add/);
    expect(source).toMatch(/optedOut\.has\(f\.contactId\)/);
  });

  it("l'exclusion reste cloisonnee par organisation", () => {
    const bloc = source.slice(source.indexOf("const optedOut"), source.indexOf("// Construction des candidats"));
    expect(bloc).toMatch(/contactsTable\.organisationId/);
  });
});
