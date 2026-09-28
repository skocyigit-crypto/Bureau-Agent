/**
 * Les alertes « en lot » du moteur d'automatisation appartiennent a UNE
 * organisation — et quelqu'un les voit.
 *
 * Messages non lus, contacts inactifs, appels manques : ces trois controles
 * comptaient sur toutes les organisations a la fois et ecrivaient une
 * notification sans `organisationId` ni `userId`. `GET /notifications` ne
 * montre une notification sans destinataire qu'a son organisation : celles-ci
 * n'etaient montrees a personne, alors que l'ecran listait les regles comme
 * actives. Ici : deux organisations, les vrais controles, la vraie route.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, callsTable, contactsTable, messagesTable, notificationsTable, organisationsTable, usersTable,
} from "@workspace/db";
import { checkInactiveContacts, checkMissedCalls, checkUnreadMessages } from "../services/automation-engine";
import automationsRouter from "../routes/automations";

const stamp = Date.now();
let orgA = 0, orgB = 0, userA = 0, userB = 0;
const ilYaDeuxHeures = () => new Date(Date.now() - 2 * 3600_000);

async function org(suffixe: string): Promise<{ o: number; u: number }> {
  const [o] = await db.insert(organisationsTable).values({
    name: `Alertes ${suffixe} ${stamp}`, slug: `alertes-${suffixe}-${stamp}`, maxUsers: 5, actif: true,
  }).returning({ id: organisationsTable.id });
  const [u] = await db.insert(usersTable).values({
    organisationId: o!.id, email: `alertes-${suffixe}-${stamp}@example.test`, passwordHash: "x",
    prenom: "A", nom: suffixe, role: "agent", actif: true,
  }).returning({ id: usersTable.id });
  return { o: o!.id, u: u!.id };
}

async function messagesNonLus(o: number, n: number) {
  for (let i = 0; i < n; i++) {
    await db.insert(messagesTable).values({
      organisationId: o, isRead: false, createdAt: ilYaDeuxHeures(),
      phoneNumber: `+3361000000${i}`, content: `Message ${i}`,
    } as any);
  }
}

const alertesDe = async (o: number, sourceType: string) =>
  db.select().from(notificationsTable).where(and(
    eq(notificationsTable.organisationId, o),
    eq(notificationsTable.sourceType, sourceType),
  ));

function appli(userId: number, organisationId: number) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId, userRole: "agent" };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", automationsRouter);
  return a;
}

beforeAll(async () => {
  ({ o: orgA, u: userA } = await org("a"));
  ({ o: orgB, u: userB } = await org("b"));
}, 60_000);

beforeEach(async () => {
  // Les controles comptent sur toute la base : on retire les alertes laissees
  // par d'autres suites pour lire les notres sans bruit.
  await db.delete(notificationsTable).where(inArray(notificationsTable.organisationId, [orgA, orgB]));
  await db.delete(messagesTable).where(inArray(messagesTable.organisationId, [orgA, orgB]));
  await db.delete(callsTable).where(inArray(callsTable.organisationId, [orgA, orgB]));
  await db.delete(contactsTable).where(inArray(contactsTable.organisationId, [orgA, orgB]));
});

afterAll(async () => {
  try {
    for (const o of [orgA, orgB]) {
      await db.delete(notificationsTable).where(eq(notificationsTable.organisationId, o));
      await db.delete(messagesTable).where(eq(messagesTable.organisationId, o));
      await db.delete(callsTable).where(eq(callsTable.organisationId, o));
      await db.delete(contactsTable).where(eq(contactsTable.organisationId, o));
      await db.delete(usersTable).where(eq(usersTable.organisationId, o));
      await db.delete(organisationsTable).where(eq(organisationsTable.id, o));
    }
  } catch { /* best-effort */ }
});

describe("messages non lus", () => {
  it("chaque organisation recoit SON alerte, avec SON compte", async () => {
    await messagesNonLus(orgA, 2);
    await messagesNonLus(orgB, 3);
    await checkUnreadMessages();
    const [a] = await alertesDe(orgA, "unread_messages");
    const [b] = await alertesDe(orgB, "unread_messages");
    expect(a?.message).toMatch(/\b2 message/);
    expect(b?.message).toMatch(/\b3 message/);
  });

  it("l'alerte est visible dans GET /notifications de l'organisation", async () => {
    await messagesNonLus(orgA, 1);
    await checkUnreadMessages();
    const r = await request(appli(userA, orgA)).get("/api/notifications?limit=100");
    expect(r.status).toBe(200);
    expect(r.body.notifications.some((n: { sourceType: string }) => n.sourceType === "unread_messages")).toBe(true);
  });

  it("et invisible pour une autre organisation", async () => {
    await messagesNonLus(orgA, 1);
    await checkUnreadMessages();
    const r = await request(appli(userB, orgB)).get("/api/notifications?limit=100");
    expect(r.body.notifications.some((n: { sourceType: string }) => n.sourceType === "unread_messages")).toBe(false);
  });

  it("une alerte non lue chez A ne bloque pas celle de B", async () => {
    await messagesNonLus(orgA, 1);
    await checkUnreadMessages();
    await messagesNonLus(orgB, 1);
    await checkUnreadMessages();
    expect(await alertesDe(orgB, "unread_messages")).toHaveLength(1);
  });

  it("un second passage ne duplique pas l'alerte", async () => {
    await messagesNonLus(orgA, 1);
    await checkUnreadMessages();
    await checkUnreadMessages();
    expect(await alertesDe(orgA, "unread_messages")).toHaveLength(1);
  });

  it("sans message non lu, aucune alerte", async () => {
    await checkUnreadMessages();
    expect(await alertesDe(orgA, "unread_messages")).toHaveLength(0);
  });
});

describe("appels manques et contacts inactifs", () => {
  it("les appels manques du jour sont comptes par organisation", async () => {
    await db.insert(callsTable).values([
      { organisationId: orgA, direction: "entrant", status: "manque", phoneNumber: "+33100000001", contactName: "X" },
      { organisationId: orgA, direction: "entrant", status: "manque", phoneNumber: "+33100000002", contactName: "Y" },
      { organisationId: orgB, direction: "entrant", status: "manque", phoneNumber: "+33100000003", contactName: "Z" },
    ] as any);
    await checkMissedCalls();
    expect((await alertesDe(orgA, "missed_calls"))[0]?.message).toMatch(/\b2 appel/);
    expect((await alertesDe(orgB, "missed_calls"))[0]?.message).toMatch(/\b1 appel/);
  });

  it("un appel repondu ne compte pas", async () => {
    await db.insert(callsTable).values({ organisationId: orgA, direction: "entrant", status: "repondu", phoneNumber: "+33100000004", contactName: "W" } as any);
    await checkMissedCalls();
    expect(await alertesDe(orgA, "missed_calls")).toHaveLength(0);
  });

  it("les contacts inactifs sont comptes par organisation", async () => {
    const vieux = new Date(Date.now() - 40 * 86_400_000);
    await db.insert(contactsTable).values([
      { organisationId: orgA, firstName: "Inactif", lastName: "Un", phone: "+33600000001", updatedAt: vieux },
      { organisationId: orgB, firstName: "Actif", lastName: "Deux", phone: "+33600000002" },
    ] as any);
    await checkInactiveContacts();
    expect((await alertesDe(orgA, "inactive_contacts"))[0]?.message).toMatch(/^1 contact/);
    expect(await alertesDe(orgB, "inactive_contacts")).toHaveLength(0);
  });
});

describe("aucune notification du moteur sans organisation", () => {
  it("chaque insertion de notification porte l'organisation (releve du source)", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "services", "automation-engine.ts"), "utf8");
    const blocs = [...src.matchAll(/insert\(notificationsTable\)\.values\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]!);
    // Garde-fou : l'instrument doit voir les insertions du moteur.
    expect(blocs.length).toBeGreaterThanOrEqual(5);
    const sansOrg = blocs.filter((b) => !/organisationId/.test(b));
    expect(sansOrg, "notification ecrite sans organisation : personne ne la verra").toEqual([]);
  });
});
