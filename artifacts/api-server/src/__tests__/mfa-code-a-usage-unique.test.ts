/**
 * Un code TOTP ne sert qu'une fois (RFC 6238 §5.2).
 *
 * `verifyMfaToken` verifiait le code sans rien retenir : un code intercepte en
 * meme temps que le mot de passe (hameconnage en temps reel, regard par-dessus
 * l'epaule) restait rejouable pendant toute sa fenetre — trente secondes plus
 * la tolerance. (Point souleve par la session BatiFlow, 22/09/2026.)
 *
 * Le dernier pas accepte est desormais garde en base, et consomme par une
 * mise a jour atomique. Teste sur la vraie application et une vraie base.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { generateSecret, generateSync } from "otplib";
import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { consommerCodeMfa, pasMfaValide } from "../services/mfa";

const stamp = Date.now();
const MOT_DE_PASSE = "Motdepasse-tres-solide-2026";
const secret = generateSecret();
let orgId = 0;
let userId = 0;
const email = `mfa-${stamp}@example.test`;

/** Le code du pas de temps courant, ou decale de `pas` pas de 30 s. */
const code = (pas = 0) => generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + pas * 30 });

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `MFA ${stamp}`, slug: `mfa-${stamp}`, email: `mfa-org-${stamp}@example.test`,
    phone: "+33123456789", maxUsers: 10, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email, passwordHash: await bcrypt.hash(MOT_DE_PASSE, 4),
    prenom: "Mfa", nom: "Test", role: "administrateur", actif: true,
    mfaActif: true, mfaSecret: secret, emailVerifie: true,
  } as any).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  await db.update(usersTable).set({ actif: false }).where(eq(usersTable.organisationId, orgId));
});

beforeEach(async () => {
  await db.update(usersTable).set({ mfaDernierPas: null, tentativesEchouees: 0, verrouilleJusqua: null } as any).where(eq(usersTable.id, userId));
});

describe("a la connexion, sur la vraie application", () => {
  const connexion = (totpCode: string) =>
    request(app).post("/api/auth/login").send({ email, password: MOT_DE_PASSE, totpCode, wantsToken: true });

  it("un code valide ouvre la session", async () => {
    const r = await connexion(code());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("le MEME code, rejoue, est refuse", async () => {
    const c = code();
    expect((await connexion(c)).status).toBe(200);
    const rejeu = await connexion(c);
    expect(rejeu.status).toBe(401);
    expect(rejeu.body.requiresMfa).toBe(true);
  });
});

describe("consommerCodeMfa", () => {
  it("accepte un code valide, une fois", async () => {
    const c = code();
    expect(await consommerCodeMfa(userId, c, secret)).toBe(true);
    expect(await consommerCodeMfa(userId, c, secret)).toBe(false);
  });

  it("retient le pas en base", async () => {
    const c = code();
    await consommerCodeMfa(userId, c, secret);
    const [u] = await db.select({ pas: usersTable.mfaDernierPas }).from(usersTable).where(eq(usersTable.id, userId));
    expect(u!.pas).toBe(pasMfaValide(c, secret));
  });

  it("deux soumissions simultanees du meme code : une seule passe", async () => {
    const c = code();
    const r = await Promise.all([1, 2, 3, 4].map(() => consommerCodeMfa(userId, c, secret)));
    expect(r.filter(Boolean).length).toBe(1);
  });

  it("le code du pas suivant passe apres celui du pas courant", async () => {
    expect(await consommerCodeMfa(userId, code(0), secret)).toBe(true);
    expect(await consommerCodeMfa(userId, code(1), secret)).toBe(true);
  });

  it("un code plus ancien que le dernier accepte est refuse", async () => {
    expect(await consommerCodeMfa(userId, code(1), secret)).toBe(true);
    expect(await consommerCodeMfa(userId, code(0), secret)).toBe(false);
  });

  it("un code faux ne consomme rien", async () => {
    expect(await consommerCodeMfa(userId, "000000", secret)).toBe(false);
    const [u] = await db.select({ pas: usersTable.mfaDernierPas }).from(usersTable).where(eq(usersTable.id, userId));
    expect(u!.pas).toBeNull();
  });

  it("le code d'un autre utilisateur ne consomme pas le sien", async () => {
    // La mise a jour est bornee a l'utilisateur : pas de fuite d'etat entre comptes.
    expect(await consommerCodeMfa(userId + 1_000_000, code(), secret)).toBe(false);
    expect(await consommerCodeMfa(userId, code(), secret)).toBe(true);
  });
});

describe("les trois portes MFA passent par la consommation", () => {
  it("connexion, activation et desactivation n'appellent plus la verification seule", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const s = readFileSync(join(import.meta.dirname, "..", "routes", "auth.ts"), "utf8");
    expect(s).not.toMatch(/verifyMfaToken\(/);
    expect((s.match(/consommerCodeMfa\(user\.id, totpCode, user\.mfaSecret\)/g) ?? []).length).toBe(3);
  });

  it("desactiver la double authentification oublie le dernier pas", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const s = readFileSync(join(import.meta.dirname, "..", "routes", "auth.ts"), "utf8");
    expect(s).toMatch(/mfaActif: false, mfaSecret: null, mfaDernierPas: null/);
  });
});
