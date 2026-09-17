/**
 * Les alertes d'equipe (userId vide) doivent etre vues par l'equipe.
 *
 * Mesure le 17/09 : la secretaire IA, les taches en retard, le quota IA et les
 * appels manques ecrivent des notifications sans userId. GET /notifications ne
 * retenait que `userId = moi` : ces alertes n'etaient montrees a personne.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, notificationsTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/automations";

const stamp = Date.now();
let orgA = 0, orgB = 0, agent = 0, admin = 0, autre = 0;

function appli(userId: number, organisationId: number, userRole: string) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId, userRole }; (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } }; next(); });
  a.use("/api", router);
  return a;
}
async function org(n: string) {
  const [o] = await db.insert(organisationsTable).values({ name: `Notif ${n} ${stamp}`, slug: `notif-${n}-${stamp}`, email: `notif-${n}-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  return o!.id;
}
async function user(o: number, n: string, role: string) {
  const [u] = await db.insert(usersTable).values({ organisationId: o, email: `notif-${n}-${stamp}@example.test`, passwordHash: "x", prenom: n, nom: "T", role, actif: true }).returning({ id: usersTable.id });
  return u!.id;
}
async function notif(v: Record<string, unknown>) {
  const [n] = await db.insert(notificationsTable).values({ type: "info", title: "T", message: "M", ...v } as any).returning();
  return n!;
}

beforeAll(async () => {
  orgA = await org("a"); orgB = await org("b");
  agent = await user(orgA, "agent", "agent");
  admin = await user(orgA, "admin", "administrateur");
  autre = await user(orgB, "autre", "agent");
}, 60_000);
afterAll(async () => {
  for (const o of [orgA, orgB]) { await db.delete(notificationsTable).where(eq(notificationsTable.organisationId, o)); await db.delete(organisationsTable).where(eq(organisationsTable.id, o)); }
  for (const u of [agent, admin, autre]) await db.delete(notificationsTable).where(eq(notificationsTable.userId, u));
});

describe("notifications d'equipe", () => {
  it("un rendez-vous pris par la secretaire IA apparait chez l'agent", async () => {
    const n = await notif({ organisationId: orgA, title: "Nouveau rendez-vous (secretaire IA)", sourceType: "ai_receptionist_appointment" });
    const r = await request(appli(agent, orgA, "agent")).get("/api/notifications");
    expect(r.status).toBe(200);
    expect(r.body.notifications.map((x: any) => x.id)).toContain(n.id);
  });

  it("le compteur de non lues inclut les alertes d'equipe", async () => {
    const r = await request(appli(admin, orgA, "administrateur")).get("/api/notifications");
    expect(r.body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("une autre organisation ne voit pas les alertes d'equipe", async () => {
    const r = await request(appli(autre, orgB, "agent")).get("/api/notifications?limit=100");
    expect(r.body.notifications.every((x: any) => x.organisationId !== orgA)).toBe(true);
  });

  it("les notifications personnelles d'un collegue restent privees", async () => {
    const n = await notif({ organisationId: orgA, userId: admin, title: "Prive admin" });
    const r = await request(appli(agent, orgA, "agent")).get("/api/notifications?limit=100");
    expect(r.body.notifications.map((x: any) => x.id)).not.toContain(n.id);
  });

  it("marquer lue une alerte d'equipe fonctionne", async () => {
    const n = await notif({ organisationId: orgA, title: "A lire" });
    await request(appli(agent, orgA, "agent")).patch(`/api/notifications/${n.id}/read`);
    const [relu] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, n.id));
    expect(relu!.read).toBe(true);
  });

  it("tout marquer lu couvre les alertes d'equipe", async () => {
    const n = await notif({ organisationId: orgA, title: "Lot" });
    await request(appli(agent, orgA, "agent")).post("/api/notifications/read-all");
    const [relu] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, n.id));
    expect(relu!.read).toBe(true);
  });

  it("marquer lue une alerte d'une autre organisation n'a aucun effet", async () => {
    const n = await notif({ organisationId: orgA, title: "Etrangere" });
    await request(appli(autre, orgB, "agent")).patch(`/api/notifications/${n.id}/read`);
    const [relu] = await db.select().from(notificationsTable).where(eq(notificationsTable.id, n.id));
    expect(relu!.read).toBe(false);
  });

  it("un agent ne peut pas supprimer une alerte d'equipe (404, conservee)", async () => {
    const n = await notif({ organisationId: orgA, title: "Garder" });
    const r = await request(appli(agent, orgA, "agent")).delete(`/api/notifications/${n.id}`);
    expect(r.status).toBe(404);
    expect((await db.select().from(notificationsTable).where(eq(notificationsTable.id, n.id))).length).toBe(1);
  });

  it("un administrateur peut supprimer une alerte d'equipe", async () => {
    const n = await notif({ organisationId: orgA, title: "Jeter" });
    const r = await request(appli(admin, orgA, "administrateur")).delete(`/api/notifications/${n.id}`);
    expect(r.status).toBe(200);
    expect((await db.select().from(notificationsTable).where(eq(notificationsTable.id, n.id))).length).toBe(0);
  });

  it("« tout supprimer » ne vide pas les alertes d'equipe", async () => {
    const equipe = await notif({ organisationId: orgA, title: "Reste" });
    const perso = await notif({ organisationId: orgA, userId: admin, title: "Part" });
    await request(appli(admin, orgA, "administrateur")).post("/api/notifications/delete-all");
    expect((await db.select().from(notificationsTable).where(eq(notificationsTable.id, equipe.id))).length).toBe(1);
    expect((await db.select().from(notificationsTable).where(eq(notificationsTable.id, perso.id))).length).toBe(0);
  });

  it("un agent supprime toujours sa propre notification", async () => {
    const n = await notif({ organisationId: orgA, userId: agent, title: "Mienne" });
    expect((await request(appli(agent, orgA, "agent")).delete(`/api/notifications/${n.id}`)).status).toBe(200);
  });
});
