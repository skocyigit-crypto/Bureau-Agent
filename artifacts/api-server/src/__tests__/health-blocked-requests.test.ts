import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Un site entierement bloque doit se voir.
 *
 * Le 14 juillet 2026, le Guardian a ferme le site a TOUS les visiteurs pendant
 * environ cinq minutes: derriere le proxy web, l'IP reelle etait perdue et
 * tout le monde arrivait depuis la meme adresse interne, qu'une pointe de
 * trafic a fait bannir. La cause a ete corrigee (X-Real-Client-IP), mais la
 * DETECTION ne l'avait pas ete: l'agent d'erreurs ne posait de constat que sur
 * les 5xx et les 429. Or un visiteur banni recoit un 403 — compte dans un
 * fourre-tout `s4xx` avec les 401 et les 404, et jamais examine. Pendant que
 * personne ne pouvait entrer, le panneau de sante etait vert.
 *
 * Ces tests fixent le seuil. Un peu de 403 est normal (un utilisateur qui
 * tente une page reservee aux administrateurs); une proportion elevee ne l'est
 * jamais et vient presque toujours de nous, pas des visiteurs.
 */

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

const { errorRateAgent, recordHttpStatus } = await import("../services/health-agents-external");

/** Vide la fenetre de mesure: elle est remise a zero a chaque lecture. */
async function drain() {
  await errorRateAgent.run();
}

async function checksFor(statuses: number[]) {
  statuses.forEach(recordHttpStatus);
  const results = await errorRateAgent.run();
  return Object.fromEntries(results.map((r) => [r.check, r]));
}

beforeEach(async () => { await drain(); });

describe("refus d'acces (403)", () => {
  it("ne dit rien quand tout passe", async () => {
    const r = await checksFor([200, 200, 200, 200]);
    expect(r.blocked_requests.status).toBe("ok");
    expect(r.blocked_requests.summary).toContain("Aucun refus");
  });

  it("tolere quelques refus: une page reservee refusee n'est pas une panne", async () => {
    const r = await checksFor([...Array(99).fill(200), 403]);
    expect(r.blocked_requests.status).toBe("ok");
  });

  it("signale une degradation des que le refus devient courant", async () => {
    const r = await checksFor([...Array(90).fill(200), ...Array(10).fill(403)]);
    expect(r.blocked_requests.status).toBe("degrade");
  });

  it("crie quand le site refuse la majorite des visiteurs — l'incident du 14 juillet", async () => {
    const r = await checksFor([...Array(10).fill(200), ...Array(90).fill(403)]);
    expect(r.blocked_requests.status).toBe("echec");
    expect(r.blocked_requests.severity).toBe("critique");
    // La remediation doit pointer vers nous, pas vers « des attaquants »: c'est
    // la conclusion erronee qui avait coute du temps la premiere fois.
    expect(r.blocked_requests.remediation).toContain("X-Real-Client-IP");
  });

  it("ne confond pas 403 avec 401 ou 404", async () => {
    // Une vague de 401 (sessions expirees) ou de 404 (scan de robots) ne doit
    // pas declencher l'alerte « le site refuse ses visiteurs ».
    const r = await checksFor([...Array(50).fill(401), ...Array(50).fill(404)]);
    expect(r.blocked_requests.status).toBe("ok");
  });

  it("continue de compter les 5xx et 429 comme avant", async () => {
    const r = await checksFor([...Array(80).fill(200), ...Array(10).fill(500), ...Array(10).fill(429)]);
    expect(r.server_errors.status).toBe("echec");
    expect(r.rate_limited.status).toBe("echec");
  });
});
