/**
 * Regression: les taches dues doivent s'enchainer, pas se lancer ensemble.
 *
 * Le declencheur externe passe toutes les 10 minutes et jusqu'a cinq taches
 * pouvaient etre dues au meme instant. Lancees en parallele, elles saturaient
 * le pool de connexions — 15/15 actives et 4 requetes en attente mesurees en
 * production, au point qu'un simple `SELECT 1` de diagnostic n'obtenait plus
 * de connexion et que la boucle d'evenements restait bloquee 2 secondes.
 * L'entretien degradait donc l'application pour les utilisateurs presents.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const heartbeats: Array<{ name: string; lastRunAt: Date }> = [];

// La table des battements est la seule source d'echeance: on la simule pour
// garder le test hermetique (aucune base requise).
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => Promise.resolve(heartbeats) }),
  },
}));
vi.mock("@workspace/db/schema", () => ({
  cronHeartbeatsTable: { name: "name", lastRunAt: "lastRunAt" },
}));

const { registerRunnableCron, runDueCrons } = await import("../services/cron-registry");

describe("runDueCrons", () => {
  beforeEach(() => {
    heartbeats.length = 0;
  });

  it("enchaine les taches dues au lieu de les lancer en parallele", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const order: string[] = [];

    const makeCron = (name: string, delayMs: number) => {
      registerRunnableCron(name, 1000, async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(name);
        concurrent--;
      });
    };

    makeCron("alpha", 20);
    makeCron("beta", 5);
    makeCron("gamma", 5);

    const result = await runDueCrons();
    expect(result.triggered).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));

    // Les taches tournent en arriere-plan: on laisse le temps a la chaine
    // complete de se terminer avant de conclure.
    await new Promise((r) => setTimeout(r, 200));

    expect(maxConcurrent).toBe(1);
    // `alpha` est la plus lente: en parallele elle finirait derniere. Enchainee,
    // elle finit d'abord — preuve que l'ordre d'inscription est respecte.
    expect(order).toEqual(["alpha", "beta", "gamma"]);
  });

  it("n'echoue pas en chaine si une tache leve une erreur", async () => {
    const done: string[] = [];
    registerRunnableCron("boom", 1000, async () => { throw new Error("panne"); });
    registerRunnableCron("apres", 1000, async () => { done.push("apres"); });

    await runDueCrons();
    await new Promise((r) => setTimeout(r, 100));

    expect(done).toContain("apres");
  });
});
