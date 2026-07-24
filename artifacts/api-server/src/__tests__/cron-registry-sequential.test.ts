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

// Budget court et deterministe: le module le lit a l'import, donc avant.
// Sans cela le test du report dependrait du budget de production (45 s).
process.env.CRON_TICK_BUDGET_MS = "50";

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

    // Les taches sont desormais ATTENDUES pendant la requete du declencheur:
    // c'est ce qui leur donne du processeur sous `cpu-throttling`. A son
    // retour, la chaine est donc terminee.
    const result = await runDueCrons();
    expect(result.triggered).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));

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

    expect(done).toContain("apres");
  });

  it("reporte les taches qui depassent le budget au lieu de faire expirer le declencheur", async () => {
    const executed: string[] = [];
    registerRunnableCron("lente", 1000, async () => {
      executed.push("lente");
      await new Promise((r) => setTimeout(r, 120));
    });
    registerRunnableCron("suivante", 1000, async () => { executed.push("suivante"); });

    const result = await runDueCrons();

    // La premiere consomme tout le budget: la seconde reste due et repartira
    // au tick suivant plutot que d'allonger indefiniment la requete.
    expect(executed).toContain("lente");
    expect(result.deferred).toContain("suivante");
    expect(result.triggered).not.toContain("suivante");
  });
});
