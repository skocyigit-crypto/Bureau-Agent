/**
 * Codes de secours de la double authentification.
 *
 * Sans eux, perdre son telephone, c'est perdre son compte : seul le support
 * peut le rouvrir, et la tentation est alors de le faire sur simple demande —
 * ce qui annule la double authentification. (Point souleve par la session
 * BatiFlow, 22/09/2026.)
 *
 * Parcours complet sur la vraie application et une vraie base : activation,
 * connexion par code de secours, usage unique, regeneration, desactivation.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { generateSync } from "otplib";
import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import {
  consommerCodeSecours, empreinteCodeSecours, genererCodesSecours, normaliserCodeSecours,
} from "../services/mfa";

const stamp = Date.now();
const MOT_DE_PASSE = "Motdepasse-tres-solide-2026";
const email = `secours-${stamp}@example.test`;
let userId = 0;
let secret = "";
let codes: string[] = [];

/**
 * Un TOTP valide et non consomme : le dernier pas retenu est oublie avant.
 * (Le refus du rejeu est teste a part, dans mfa-code-a-usage-unique.)
 */
async function totpNeuf() {
  await db.update(usersTable).set({ mfaDernierPas: null }).where(eq(usersTable.id, userId));
  return generateSync({ secret });
}

const connexion = (totpCode?: string) =>
  request(app).post("/api/auth/login").send({ email, password: MOT_DE_PASSE, ...(totpCode ? { totpCode } : {}) });

async function agentConnecte(totpCode?: string) {
  const agent = request.agent(app);
  const r = await agent.post("/api/auth/login").send({ email, password: MOT_DE_PASSE, ...(totpCode ? { totpCode } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return agent;
}

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Secours ${stamp}`, slug: `secours-${stamp}`, email: `secours-org-${stamp}@example.test`,
    phone: "+33123456789", maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  const [u] = await db.insert(usersTable).values({
    organisationId: o!.id, email, passwordHash: await bcrypt.hash(MOT_DE_PASSE, 4),
    prenom: "Secours", nom: "Test", role: "administrateur", actif: true,
  } as any).returning({ id: usersTable.id });
  userId = u!.id;

  // Activation par l'ecran, comme un utilisateur.
  const agent = await agentConnecte();
  const setup = await agent.post("/api/auth/mfa/setup").send({});
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  secret = setup.body.secret;
  const enable = await agent.post("/api/auth/mfa/enable").send({ totpCode: await totpNeuf() });
  expect(enable.status, JSON.stringify(enable.body)).toBe(200);
  codes = enable.body.codesSecours;
}, 60_000);

const lireLigne = async () =>
  (await db.select().from(usersTable).where(eq(usersTable.id, userId)))[0]!;

describe("a l'activation", () => {
  it("dix codes sont montres, une seule fois", () => {
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });

  it("la base ne garde que les empreintes, jamais les codes", async () => {
    const u = await lireLigne();
    expect(u.mfaCodesSecours).toHaveLength(10);
    const stocke = JSON.stringify(u.mfaCodesSecours);
    for (const c of codes) {
      expect(stocke).not.toContain(c);
      expect(stocke).not.toContain(c.replace("-", ""));
      expect(u.mfaCodesSecours).toContain(empreinteCodeSecours(c));
    }
  });

  it("le statut annonce le nombre de codes restants", async () => {
    const agent = await agentConnecte(await totpNeuf());
    const r = await agent.get("/api/auth/mfa/status");
    expect(r.body.codesSecoursRestants).toBeGreaterThan(0);
    expect(r.body.codesSecoursRestants).toBeLessThanOrEqual(10);
  });
});

describe("a la connexion", () => {
  it("un code de secours remplace le telephone perdu", async () => {
    const r = await connexion(codes[0]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("il ne sert qu'une fois", async () => {
    const r = await connexion(codes[0]);
    expect(r.status).toBe(401);
    expect(r.body.requiresMfa).toBe(true);
  });

  it("minuscules, espaces et sans tiret : le meme code", async () => {
    const saisie = ` ${codes[1]!.toLowerCase().replace("-", " ")} `;
    expect((await connexion(saisie)).status).toBe(200);
  });

  it("un code invente est refuse", async () => {
    expect((await connexion("ABCDE-FGHJK")).status).toBe(401);
  });

  it("chaque utilisation retire un code du compteur", async () => {
    const avant = (await lireLigne()).mfaCodesSecours!.length;
    expect((await connexion(codes[2])).status).toBe(200);
    expect((await lireLigne()).mfaCodesSecours!.length).toBe(avant - 1);
  });

  it("l'utilisation d'un code de secours est journalisee", async () => {
    const { auditLogsTable } = await import("@workspace/db");
    const lignes = await db.select().from(auditLogsTable as any).where(eq((auditLogsTable as any).userId, userId));
    expect(JSON.stringify(lignes)).toContain("mfa_recovery_code_used");
  });
});

describe("consommerCodeSecours", () => {
  it("deux soumissions simultanees du meme code : une seule passe", async () => {
    const r = await Promise.all([1, 2, 3, 4].map(() => consommerCodeSecours(userId, codes[3]!)));
    expect(r.filter(Boolean).length).toBe(1);
  });

  it("le code d'un compte ne vaut pas pour un autre", async () => {
    expect(await consommerCodeSecours(userId + 1_000_000, codes[4]!)).toBe(false);
    expect(await consommerCodeSecours(userId, codes[4]!)).toBe(true);
  });
});

describe("regeneration", () => {
  it("exige un code TOTP, pas un code de secours", async () => {
    const agent = await agentConnecte(await totpNeuf());
    const r = await agent.post("/api/auth/mfa/codes-secours").send({ totpCode: codes[5] });
    expect(r.status).toBe(400);
  });

  it("de nouveaux codes remplacent les anciens", async () => {
    const agent = await agentConnecte(await totpNeuf());
    const r = await agent.post("/api/auth/mfa/codes-secours").send({ totpCode: await totpNeuf() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const anciens = codes;
    codes = r.body.codesSecours;
    expect(codes).toHaveLength(10);
    expect((await connexion(anciens[6])).status).toBe(401);
    expect((await connexion(codes[0])).status).toBe(200);
  });
});

describe("desactivation", () => {
  it("un code de secours permet de desactiver, et efface tous les codes", async () => {
    const agent = await agentConnecte(await totpNeuf());
    const r = await agent.post("/api/auth/mfa/disable").send({ password: MOT_DE_PASSE, totpCode: codes[1] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const u = await lireLigne();
    expect(u.mfaActif).toBe(false);
    expect(u.mfaCodesSecours).toBeNull();
    expect(u.mfaSecret).toBeNull();
  });
});

describe("format des codes", () => {
  it("aucun caractere ambigu (0/O, 1/I/L) : ils se recopient depuis un papier", () => {
    const tous = genererCodesSecours(200).join("");
    expect(tous).not.toMatch(/[01OIL]/);
  });

  it("la normalisation refuse ce qui n'est pas un code", () => {
    expect(normaliserCodeSecours("123456")).toBeNull();
    expect(normaliserCodeSecours("ABCDE-FGHJ0")).toBeNull();
    expect(normaliserCodeSecours("ABCDE-FGHJKM")).toBeNull();
    expect(normaliserCodeSecours("abcde fghjk")).toBe("ABCDEFGHJK");
  });
});
