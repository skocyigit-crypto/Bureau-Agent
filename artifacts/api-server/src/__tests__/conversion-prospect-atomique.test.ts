/**
 * Convertir un prospect en contact : deux ecritures qui devaient tenir
 * ensemble, et un garde-fou qui ne tenait pas.
 *
 * La route inserait le contact, PUIS marquait le prospect comme lie. Entre
 * les deux, rien. Le garde-fou (« deja lie a un contact ») lisait `contactId`
 * avant d'agir, ce qui laissait deux facons d'obtenir exactement le doublon
 * qu'il existe pour empecher :
 *
 *  1. le contact est insere, la mise a jour du prospect echoue — coupure,
 *     contrainte, redemarrage. Le contact existe, le prospect ne le sait pas,
 *     et le clic suivant repasse la garde et en cree un deuxieme ;
 *  2. deux clics partent ensemble (double-clic, deux commerciaux sur la meme
 *     fiche). Les deux lisent `contactId` vide, les deux inserent.
 *
 * Un doublon de contact ne se repare pas tout seul : il part dans les devis,
 * les factures et les relances, et quelqu'un doit fusionner a la main.
 *
 * Ces controles passent par le VRAI routeur et la VRAIE base. Une assertion
 * sur le source dirait que `db.transaction` est ecrit, pas que Postgres
 * annule l'insertion du perdant.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { contactsTable, db, organisationsTable, prospectsTable, usersTable } from "@workspace/db";
import router from "../routes/prospects";

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

async function prospect(v: Record<string, unknown> = {}) {
  const [p] = await db.insert(prospectsTable).values({
    organisationId: orgId,
    title: `Chantier ${stamp}`,
    contactName: "Jean Dupont",
    company: "Dupont BTP",
    email: `jean-${stamp}@exemple.test`,
    phone: "0600000000",
    stage: "negociation",
    priority: "haute",
    ...v,
  } as any).returning();
  return p!;
}

const contactsDuProspect = async (titre: string) =>
  db.select().from(contactsTable).where(
    and(eq(contactsTable.organisationId, orgId), eq(contactsTable.notes, `Converti depuis prospect: ${titre}`)),
  );

const relire = async (id: number) =>
  (await db.select().from(prospectsTable).where(eq(prospectsTable.id, id)))[0]!;

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Conversion ${stamp}`, slug: `conversion-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `conv-${stamp}@example.test`, passwordHash: "x",
    prenom: "C", nom: "V", role: "administrateur", actif: true,
  }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(prospectsTable).where(eq(prospectsTable.organisationId, orgId));
    await db.delete(contactsTable).where(eq(contactsTable.organisationId, orgId));
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

describe("convertir un prospect en contact", () => {
  it("cree le contact et lie le prospect", async () => {
    const p = await prospect();
    const r = await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    expect(r.status).toBe(201);
    expect(r.body.contact?.id).toBeTypeOf("number");
    const apres = await relire(p.id);
    expect(apres.contactId, "le prospect doit porter le contact cree").toBe(r.body.contact.id);
  });

  it("le prospect passe a l'etape gagne", async () => {
    const p = await prospect();
    await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    expect((await relire(p.id)).stage).toBe("gagne");
  });

  it("le nom du prospect est reparti en prenom et nom", async () => {
    const p = await prospect({ contactName: "Marie Claire Martin" });
    const r = await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    expect(r.body.contact.firstName).toBe("Marie");
    expect(r.body.contact.lastName).toBe("Claire Martin");
  });

  it("une deuxieme conversion est refusee", async () => {
    const p = await prospect();
    await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    const deux = await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    expect(deux.status).toBe(409);
  });

  it("et elle ne laisse pas un deuxieme contact derriere elle", async () => {
    const titre = `Double ${stamp}-${Math.random()}`;
    const p = await prospect({ title: titre });
    await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    expect((await contactsDuProspect(titre)).length, "un doublon a ete cree").toBe(1);
  });

  it("deux clics simultanes ne creent qu'un seul contact", async () => {
    // Le coeur du defaut : les deux lisent `contactId` vide avant que l'un
    // des deux ne l'ecrive.
    const titre = `Simultane ${stamp}-${Math.random()}`;
    const p = await prospect({ title: titre });
    const a = appli();
    const [r1, r2] = await Promise.all([
      request(a).post(`/api/prospects/${p.id}/convert`).send({}),
      request(a).post(`/api/prospects/${p.id}/convert`).send({}),
    ]);
    const contacts = await contactsDuProspect(titre);
    expect(contacts.length, `deux contacts crees (statuts ${r1.status}/${r2.status})`).toBe(1);
  });

  it("et l'un des deux appels seulement reussit", async () => {
    const titre = `Course ${stamp}-${Math.random()}`;
    const p = await prospect({ title: titre });
    const a = appli();
    const reponses = await Promise.all([
      request(a).post(`/api/prospects/${p.id}/convert`).send({}),
      request(a).post(`/api/prospects/${p.id}/convert`).send({}),
    ]);
    expect(reponses.filter((r) => r.status === 201).length, "les deux ont cru avoir converti").toBe(1);
  });

  it("le prospect pointe vers le contact qui existe vraiment", async () => {
    // Un `contactId` qui ne designe rien serait pire qu'un doublon : la fiche
    // s'ouvre sur du vide et la conversion ne peut plus etre relancee.
    const p = await prospect();
    await request(appli()).post(`/api/prospects/${p.id}/convert`).send({});
    const { contactId } = await relire(p.id);
    const [contact] = await db.select().from(contactsTable)
      .where(and(eq(contactsTable.id, contactId!), eq(contactsTable.organisationId, orgId)));
    expect(contact, "le prospect designe un contact inexistant").toBeTruthy();
  });

  it("un prospect d'une autre organisation n'est pas convertible", async () => {
    const [autre] = await db.insert(organisationsTable).values({
      name: `Autre ${stamp}`, slug: `autre-conv-${stamp}`, maxUsers: 2, actif: true,
    }).returning({ id: organisationsTable.id });
    try {
      const [p] = await db.insert(prospectsTable).values({
        organisationId: autre!.id, title: `Ailleurs ${stamp}`, contactName: "X Y", stage: "nouveau", priority: "basse",
      } as any).returning();
      const r = await request(appli()).post(`/api/prospects/${p!.id}/convert`).send({});
      expect(r.status).toBe(404);
      await db.delete(prospectsTable).where(eq(prospectsTable.organisationId, autre!.id));
    } finally {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id));
    }
  });

  it("un identifiant qui n'est pas un nombre est refuse", async () => {
    const r = await request(appli()).post("/api/prospects/abc/convert").send({});
    expect(r.status).toBe(400);
  });

  it("un prospect inexistant renvoie 404", async () => {
    const r = await request(appli()).post("/api/prospects/99999999/convert").send({});
    expect(r.status).toBe(404);
  });
});
