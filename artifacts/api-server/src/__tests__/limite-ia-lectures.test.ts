/**
 * Naviguer dans l'application ne doit pas epuiser le budget IA.
 *
 * Mesure le 18/09 sur le banc local : `app.use("/api/ai", aiLimiter)` couvrait
 * tout le prefixe, y compris des lectures qui n'appellent aucun modele. Vingt
 * lectures d'etat (`/ai/agents/run/status`, appelee par l'ecran toutes les
 * quelques secondes) suffisaient a consommer les 15 appels/minute : dix etaient
 * refusees, et l'appel suivant vers une vraie fonction IA recevait
 * « Limite d'analyse IA atteinte » alors que le client n'avait rien demande.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost";

import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { consommeBudgetIa, voixConsommeBudgetIa } from "../services/limite-ia-chemins";

/** Combien de 429 sur N appels identiques, sans session (le limiteur agit avant la route). */
async function refus(methode: "get" | "post", chemin: string, n: number): Promise<number> {
  let compte = 0;
  for (let i = 0; i < n; i++) {
    const r = await request(app)[methode](chemin).set("Origin", "http://localhost").send(methode === "post" ? {} : undefined);
    if (r.status === 429) compte++;
  }
  return compte;
}

describe("quels chemins consomment le budget IA", () => {
  it("l'etat d'une analyse en cours : non", () => {
    expect(consommeBudgetIa("GET", "/agents/run/status")).toBe(false);
  });
  it("la liste des rapports deja produits : non", () => {
    expect(consommeBudgetIa("GET", "/agents/reports")).toBe(false);
    expect(consommeBudgetIa("GET", "/agents/reports/42")).toBe(false);
  });
  it("la configuration et l'autopilote : non", () => {
    expect(consommeBudgetIa("GET", "/agents/config")).toBe(false);
    expect(consommeBudgetIa("GET", "/autopilot/status")).toBe(false);
    expect(consommeBudgetIa("GET", "/autopilot/logs")).toBe(false);
  });
  it("« recognize », qui n'est que du SQL malgre son nom : non", () => {
    expect(consommeBudgetIa("POST", "/recognize")).toBe(false);
  });
  it("lancer une analyse : OUI", () => {
    expect(consommeBudgetIa("POST", "/agents/run")).toBe(true);
    expect(consommeBudgetIa("POST", "/agents/run/commercial")).toBe(true);
  });
  it("rediger un e-mail, analyser, l'autopilote qui s'execute : OUI", () => {
    expect(consommeBudgetIa("POST", "/draft-email")).toBe(true);
    expect(consommeBudgetIa("POST", "/analyse")).toBe(true);
    expect(consommeBudgetIa("POST", "/autopilot/run")).toBe(true);
  });
  it("un chemin inconnu consomme, par prudence", () => {
    expect(consommeBudgetIa("POST", "/nouvelle-fonction-ia")).toBe(true);
  });
  it("une requete de decouverte CORS ne consomme rien", () => {
    expect(consommeBudgetIa("OPTIONS", "/analyse")).toBe(false);
  });
});

describe("assistant vocal : la liste des phrases n'est pas un appel IA", () => {
  it("la liste des commandes : ne consomme pas", () => {
    expect(voixConsommeBudgetIa("GET", "/commands")).toBe(false);
  });
  it("annuler une commande : ne consomme pas", () => {
    expect(voixConsommeBudgetIa("POST", "/cancel")).toBe(false);
  });
  it("dicter une commande ou discuter : OUI", () => {
    expect(voixConsommeBudgetIa("POST", "/command")).toBe(true);
    expect(voixConsommeBudgetIa("POST", "/chat")).toBe(true);
    expect(voixConsommeBudgetIa("POST", "/site-ops")).toBe(true);
  });
  it("vingt lectures de la liste ne declenchent aucun refus", async () => {
    expect(await refus("get", "/api/voice/commands?lang=fr", 20)).toBe(0);
  }, 60_000);
  it("les commandes vocales restent bornees", async () => {
    expect(await refus("post", "/api/voice/command", 20)).toBeGreaterThan(0);
  }, 60_000);
});

describe("comportement de l'application", () => {
  it("vingt lectures d'etat ne declenchent aucun refus", async () => {
    expect(await refus("get", "/api/ai/agents/run/status", 20)).toBe(0);
  }, 60_000);

  it("vingt appels de modele restent bornes", async () => {
    expect(await refus("post", "/api/ai/draft-email", 20)).toBeGreaterThan(0);
  }, 60_000);

  it("les lectures restent servies apres que le budget modele est epuise", async () => {
    await refus("post", "/api/ai/draft-email", 20);
    const r = await request(app).get("/api/ai/agents/run/status").set("Origin", "http://localhost");
    expect(r.status).not.toBe(429);
  }, 60_000);
});
