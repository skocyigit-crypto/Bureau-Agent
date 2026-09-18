/**
 * Cinq salaries derriere une meme box ne doivent pas s'etrangler mutuellement.
 * Voir lib/request-ip.ts (cleLimiteApplicative) pour la mesure.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";

import { describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleLimiteApplicative, rateLimitKey } from "../lib/request-ip";

const APP = readFileSync(join(import.meta.dirname, "..", "app.ts"), "utf8");
const AUTH = readFileSync(join(import.meta.dirname, "..", "routes", "auth.ts"), "utf8");

/** Mini-application : session simulee par un en-tete de test, limite a 3. */
function application() {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const u = req.header("x-test-user");
    (req as any).session = u ? { userId: Number(u) } : {};
    next();
  });
  app.use(rateLimit({ keyGenerator: cleLimiteApplicative, windowMs: 60_000, max: 3, validate: false }));
  app.get("/", (_req, res) => { res.send("ok"); });
  return app;
}

describe("cle des limiteurs applicatifs", () => {
  it("utilisateur connecte : sa propre cle", () => {
    expect(cleLimiteApplicative({ session: { userId: 42 }, ip: "203.0.113.5", headers: {}, socket: {} } as any)).toBe("utilisateur:42");
  });
  it("sans session : l'IP, comme avant", () => {
    const req = { session: {}, ip: "203.0.113.5", headers: {}, socket: {} } as any;
    expect(cleLimiteApplicative(req)).toBe(rateLimitKey(req));
  });
  it("identifiant non entier ou chaine : pas de cle utilisateur", () => {
    for (const userId of ["42", 0, -1, 1.5, null]) {
      expect(cleLimiteApplicative({ session: { userId }, ip: "203.0.113.5", headers: {}, socket: {} } as any)).not.toMatch(/^utilisateur:/);
    }
  });
});

describe("meme IP, plusieurs salaries (mesure HTTP)", () => {
  it("l'epuisement du quota d'un salarie n'atteint pas son collegue", async () => {
    const app = application();
    for (let i = 0; i < 3; i++) expect((await request(app).get("/").set("x-test-user", "1")).status).toBe(200);
    expect((await request(app).get("/").set("x-test-user", "1")).status).toBe(429);
    expect((await request(app).get("/").set("x-test-user", "2")).status).toBe(200);
  });
  it("un appelant non connecte reste limite par IP", async () => {
    const app = application();
    for (let i = 0; i < 3; i++) await request(app).get("/");
    expect((await request(app).get("/")).status).toBe(429);
  });
  it("un en-tete choisi par l'appelant ne cree pas de nouvelle cle", async () => {
    // Seule la session (cookie signe, verifie par le serveur) compte : changer un
    // en-tete arbitraire a chaque requete ne doit pas remettre le compteur a zero.
    const app = application();
    for (let i = 0; i < 3; i++) await request(app).get("/").set("authorization", `Bearer faux-${i}`);
    expect((await request(app).get("/").set("authorization", "Bearer faux-9")).status).toBe(429);
  });
});

describe("branchement", () => {
  it("general, ecritures et IA utilisent la cle applicative", () => {
    for (const nom of ["generalLimiter", "strictLimiter", "aiLimiter"]) {
      const i = APP.indexOf(`const ${nom} = rateLimit({`);
      expect(APP.slice(i, i + 120), nom).toContain("keyGenerator: cleLimiteApplicative");
    }
  });
  it("la session est montee AVANT les limiteurs", () => {
    // Le montage IA est desormais conditionnel (services/limite-ia-chemins.ts) :
    // on repere le prefixe, pas la ligne exacte, pour que le test continue de
    // mesurer l'ORDRE et non la forme du code.
    expect(APP.indexOf("app.use(sessionMiddleware);")).toBeLessThan(APP.indexOf('app.use("/api/ai"'));
  });
  it("connexion et reinitialisation restent par IP", () => {
    expect(AUTH).not.toContain("cleLimiteApplicative");
  });
});
