/**
 * Declencheurs d'automatisation (base reelle).
 *
 * Mesure le 17/09 : l'ecran proposait « Nouveau projet cree » ; le moteur ne
 * connaissait pas ce declencheur et son `default` renvoyait un element factice.
 * La regle executait donc ses actions a chaque passage (notification en boucle,
 * propositions d'e-mail/SMS en file), sans qu'aucun projet n'ait ete cree.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { automationRulesTable, db, organisationsTable, projetsTable, usersTable } from "@workspace/db";
import router from "../routes/automations";
import { getTriggerItems } from "../services/automation-engine";
import { lireActions } from "../services/automation-declencheurs";

const stamp = Date.now();
let orgId = 0, userId = 0;

function appli(role = "administrateur") {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => { (req as any).session = { userId, organisationId: orgId, userRole: role, userEmail: `auto-${stamp}@example.test` }; (req as any).log = { info() {}, warn() {}, error() {} }; next(); });
  a.use("/api", router);
  return a;
}
const creerRegle = (corps: Record<string, unknown>) => request(appli()).post("/api/automations").send({
  name: "Regle test", type: "personnalisee", trigger: "schedule", schedule: "1h",
  actions: [{ type: "send_notification", params: { title: "Coucou" } }], ...corps,
});

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({ name: `Auto ${stamp}`, slug: `auto-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({ organisationId: orgId, email: `auto-${stamp}@example.test`, passwordHash: "x", prenom: "A", nom: "U", role: "administrateur", actif: true }).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);
afterAll(async () => {
  // Menage au mieux : le journal d'audit est en ajout seul (ids horodates).
  try {
    await db.delete(automationRulesTable).where(eq(automationRulesTable.organisationId, orgId));
    await db.delete(projetsTable).where(eq(projetsTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* best-effort */ }
});

describe("moteur : ce qui declenche une regle", () => {
  it("un declencheur inconnu ne declenche RIEN", async () => {
    const items = await getTriggerItems({ organisationId: orgId, trigger: "quand_je_veux", schedule: "1h", name: "X" });
    expect(items).toEqual([]);
  });

  it("projet_created ne rapporte que les projets recents", async () => {
    await db.insert(projetsTable).values({ organisationId: orgId, title: "Ancien chantier", createdAt: new Date(Date.now() - 30 * 86_400_000) } as any);
    const [neuf] = await db.insert(projetsTable).values({ organisationId: orgId, title: "Chantier du jour" } as any).returning({ id: projetsTable.id });
    const items = await getTriggerItems({ organisationId: orgId, trigger: "projet_created", schedule: "1h", name: "X" });
    expect(items.map((i: any) => i.id)).toEqual([neuf!.id]);
  });

  it("projet_created ne voit pas les projets d'une autre organisation", async () => {
    const [autre] = await db.insert(organisationsTable).values({ name: `Auto2 ${stamp}`, slug: `auto2-${stamp}`, maxUsers: 5, actif: true }).returning({ id: organisationsTable.id });
    await db.insert(projetsTable).values({ organisationId: autre!.id, title: "Chez le voisin" } as any);
    const items = await getTriggerItems({ organisationId: orgId, trigger: "projet_created", schedule: "1h", name: "X" });
    expect(items.every((i: any) => i.title !== "Chez le voisin")).toBe(true);
    await db.delete(projetsTable).where(eq(projetsTable.organisationId, autre!.id));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, autre!.id));
  });

  it("schedule declenche toujours", async () => {
    expect((await getTriggerItems({ organisationId: orgId, trigger: "schedule", schedule: "1h", name: "X" })).length).toBe(1);
  });
});

describe("creation d'une regle", () => {
  it("declencheur inconnu refuse", async () => {
    const r = await creerRegle({ trigger: "quand_je_veux" });
    expect(r.status).toBe(400);
    expect(r.body.declencheurs).toContain("projet_created");
  });

  it("cadence inconnue refusee", async () => {
    expect((await creerRegle({ schedule: "3s" })).status).toBe(400);
  });

  it("action inconnue refusee", async () => {
    expect((await creerRegle({ actions: [{ type: "lancer_les_fusees" }] })).status).toBe(400);
  });

  it("liste d'actions vide refusee", async () => {
    expect((await creerRegle({ actions: [] })).status).toBe(400);
  });

  it("actions non conformes refusees (pure)", () => {
    expect(lireActions("send_sms").ok).toBe(false);
    expect(lireActions([{ type: "send_sms", params: "0600000000" }]).ok).toBe(false);
    expect(lireActions([{ type: "send_sms", params: { to: "0600000000" } }]).ok).toBe(true);
  });

  it("nom de 300 caracteres refuse", async () => {
    expect((await creerRegle({ name: "x".repeat(300) })).status).toBe(400);
  });

  it("une regle valide est enregistree avec ses actions nettoyees", async () => {
    const r = await creerRegle({ trigger: "projet_created", actions: [{ type: "send_notification", params: { title: "Nouveau chantier {{title}}" }, sournois: true }] });
    expect(r.status).toBe(201);
    const [regle] = await db.select().from(automationRulesTable).where(eq(automationRulesTable.id, r.body.id));
    expect(regle!.actions).toEqual([{ type: "send_notification", params: { title: "Nouveau chantier {{title}}" } }]);
  });

  it("un agent ne cree pas de regle", async () => {
    const a = appli("agent");
    expect((await request(a).post("/api/automations").send({ name: "X", type: "t", trigger: "schedule", actions: [{ type: "send_notification" }] })).status).toBe(403);
  });

  it("modifier une regle avec une cadence inconnue est refuse", async () => {
    const r = await creerRegle({});
    expect((await request(appli()).patch(`/api/automations/${r.body.id}`).send({ schedule: "3s" })).status).toBe(400);
  });
});
