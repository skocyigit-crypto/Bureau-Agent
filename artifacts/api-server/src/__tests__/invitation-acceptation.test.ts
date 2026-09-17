/**
 * Acceptation d'une invitation (route publique, base reelle, vrai routeur).
 *
 * Mesure le 17/09 : deux clics simultanes -> le second 500 (unicite email),
 * nom de plus de 100 caracteres -> 500, nom numerique -> avatar « UNDEFINED »,
 * organisation desactivee -> compte cree quand meme.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, invitationsTable, organisationsTable, usersTable } from "@workspace/db";
import router from "../routes/invitations";

const stamp = Date.now();
let orgId = 0, orgInactive = 0, n = 0;
const MDP = "Chantier-Solide-2026!x";

function appli() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const session: any = { regenerate(cb: (e?: unknown) => void) { cb(); }, save(cb?: () => void) { cb?.(); } };
    (req as any).session = session;
    (req as any).log = { info() {}, warn() {}, error(e: unknown) { console.error(e); } };
    next();
  });
  a.use("/api", router);
  return a;
}
async function invitation(o = orgId, v: Record<string, unknown> = {}) {
  const raw = crypto.randomBytes(32).toString("hex");
  const email = `invite-${stamp}-${++n}@example.test`;
  await db.insert(invitationsTable).values({
    organisationId: o, email, token: crypto.createHash("sha256").update(raw).digest("hex"),
    invitedBy: 1, role: "agent", status: "pending", expiresAt: new Date(Date.now() + 86_400_000), ...v,
  } as any);
  return { raw, email };
}
const accepter = (raw: string, corps: Record<string, unknown>) => request(appli()).post(`/api/invitations/accept/${raw}`).send(corps);
const utilisateur = async (email: string) => (await db.select().from(usersTable).where(eq(usersTable.email, email)))[0];

beforeAll(async () => {
  const [a] = await db.insert(organisationsTable).values({ name: `Inv ${stamp}`, slug: `inv-${stamp}`, maxUsers: 50, actif: true }).returning({ id: organisationsTable.id });
  const [b] = await db.insert(organisationsTable).values({ name: `InvOff ${stamp}`, slug: `invoff-${stamp}`, maxUsers: 50, actif: false }).returning({ id: organisationsTable.id });
  orgId = a!.id; orgInactive = b!.id;
}, 60_000);
afterAll(async () => {
  // Best-effort : le journal d'audit est en ajout seul, il retient les comptes
  // crees (ids uniques par execution grace a `stamp`).
  for (const o of [orgId, orgInactive]) {
    try { await db.delete(invitationsTable).where(eq(invitationsTable.organisationId, o)); } catch { /* best-effort */ }
  }
});

describe("acceptation d'invitation", () => {
  it("cas nominal : compte cree, invitation consommee", async () => {
    const { raw, email } = await invitation();
    const r = await accepter(raw, { prenom: " Jean ", nom: "Dupont", password: MDP });
    expect(r.status).toBe(201);
    const u = await utilisateur(email);
    expect([u?.prenom, u?.avatar, u?.organisationId]).toEqual(["Jean", "JD", orgId]);
  });

  it("deux clics simultanes : un compte, aucune erreur 500", async () => {
    const { raw, email } = await invitation();
    const [a, b] = await Promise.all([
      accepter(raw, { prenom: "Luc", nom: "Double", password: MDP }),
      accepter(raw, { prenom: "Luc", nom: "Double", password: MDP }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 410]);
    expect((await db.select().from(usersTable).where(eq(usersTable.email, email))).length).toBe(1);
  });

  it("invitation deja utilisee : 410", async () => {
    const { raw } = await invitation();
    await accepter(raw, { prenom: "A", nom: "B", password: MDP });
    expect((await accepter(raw, { prenom: "A", nom: "B", password: MDP })).status).toBe(410);
  });

  it("nom de 150 caracteres : 400, pas 500", async () => {
    const { raw } = await invitation();
    expect((await accepter(raw, { prenom: "A", nom: "x".repeat(150), password: MDP })).status).toBe(400);
  });

  it("nom numerique : 400 (plus d'avatar « UNDEFINED »)", async () => {
    const { raw } = await invitation();
    expect((await accepter(raw, { prenom: 12, nom: 34, password: MDP })).status).toBe(400);
  });

  it("nom fait d'espaces : 400", async () => {
    const { raw } = await invitation();
    expect((await accepter(raw, { prenom: "   ", nom: "B", password: MDP })).status).toBe(400);
  });

  it("organisation desactivee : 410, aucun compte", async () => {
    const { raw, email } = await invitation(orgInactive);
    expect((await accepter(raw, { prenom: "A", nom: "B", password: MDP })).status).toBe(410);
    expect(await utilisateur(email)).toBeUndefined();
  });

  it("invitation expiree : 410, aucun compte", async () => {
    const { raw, email } = await invitation(orgId, { expiresAt: new Date(Date.now() - 1000) });
    expect((await accepter(raw, { prenom: "A", nom: "B", password: MDP })).status).toBe(410);
    expect(await utilisateur(email)).toBeUndefined();
  });

  it("mot de passe faible refuse, invitation reste utilisable", async () => {
    const { raw } = await invitation();
    expect((await accepter(raw, { prenom: "A", nom: "B", password: "123" })).status).toBe(400);
    expect((await accepter(raw, { prenom: "A", nom: "B", password: MDP })).status).toBe(201);
  });

  it("jeton inconnu : 404", async () => {
    expect((await accepter("f".repeat(64), { prenom: "A", nom: "B", password: MDP })).status).toBe(404);
  });
});
