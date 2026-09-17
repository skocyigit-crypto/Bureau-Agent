/**
 * Demande de passage a un plan payant (canal de vente tant que Stripe n'est
 * pas active).
 *
 * Mesure le 17/09 : n'importe quel membre (agent, lecture seule) pouvait
 * engager la societe, et le message libre partait tel quel en HTML dans le
 * mail des administrateurs de la plateforme.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envois: { to: string; html: string; text: string }[] = [];
vi.mock("../services/email", () => ({
  sendEmail: async (to: string, _s: string, html: string, text: string) => { envois.push({ to, html, text }); return { success: true }; },
}));

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, notificationsTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/my-subscription";

const stamp = Date.now();
let orgId = 0, adminId = 0, agentId = 0, lectureId = 0, plateformeId = 0;

function appli(userId: number, userRole: string) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole }; (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } }; next(); });
  a.use("/api", router);
  return a;
}
async function user(n: string, role: string) {
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `plan-${n}-${stamp}@example.test`, passwordHash: "x", prenom: n, nom: "T", role, actif: true }).returning({ id: usersTable.id });
  return u!.id;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Plan <b>${stamp}</b>`, slug: `plan-${stamp}`, email: `plan-${stamp}@example.test`, phone: "+33123456789", maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  adminId = await user("admin", "administrateur");
  agentId = await user("agent", "agent");
  lectureId = await user("lecture", "lecture_seule");
  plateformeId = await user("plateforme", "super_admin");
}, 60_000);
afterAll(async () => {
  await db.delete(notificationsTable).where(eq(notificationsTable.organisationId, orgId));
  await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
});
beforeEach(() => { envois.length = 0; });

const monEnvoi = () => envois.filter((e) => e.to === `plan-plateforme-${stamp}@example.test`);

describe("demande de changement de plan", () => {
  it("un agent ne peut pas engager la societe (403)", async () => {
    expect((await request(appli(agentId, "agent")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel" })).status).toBe(403);
  });

  it("un compte lecture seule non plus (403)", async () => {
    expect((await request(appli(lectureId, "lecture_seule")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel" })).status).toBe(403);
  });

  it("un refus n'envoie aucun mail ni notification", async () => {
    await request(appli(agentId, "agent")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel" });
    await new Promise((r) => setTimeout(r, 20));
    expect(monEnvoi()).toEqual([]);
  });

  it("un administrateur envoie la demande (200)", async () => {
    const r = await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel", message: "Merci" });
    expect(r.status).toBe(200);
  });

  it("l'administrateur de la plateforme recoit une notification", async () => {
    await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel" });
    const n = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, plateformeId));
    expect(n.some((x) => x.organisationId === orgId)).toBe(true);
  });

  it("et un mail", async () => {
    await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel" });
    await new Promise((r) => setTimeout(r, 20));
    expect(monEnvoi().length).toBe(1);
  });

  it("le message libre est echappe dans le HTML du mail", async () => {
    await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel", message: `<a href="https://piege.example">Cliquez</a>` });
    await new Promise((r) => setTimeout(r, 20));
    const html = monEnvoi()[0]!.html;
    expect(html).not.toContain(`<a href`);
    expect(html).toContain("&lt;a href=");
  });

  it("le nom de l'organisation est echappe aussi", async () => {
    await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel" });
    await new Promise((r) => setTimeout(r, 20));
    expect(monEnvoi()[0]!.html).not.toContain("<b>");
  });

  it("le message est borne a 1000 caracteres", async () => {
    await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel", message: "x".repeat(5000) });
    await new Promise((r) => setTimeout(r, 20));
    expect(monEnvoi()[0]!.text.length).toBeLessThan(1300);
  });

  it("un message non textuel est ignore sans erreur", async () => {
    expect((await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "professionnel", message: { a: 1 } })).status).toBe(200);
  });

  it("un plan inconnu est refuse (400)", async () => {
    expect((await request(appli(adminId, "administrateur")).post("/api/my-subscription/upgrade-request").send({ targetPlan: "illimite-gratuit" })).status).toBe(400);
  });
});
