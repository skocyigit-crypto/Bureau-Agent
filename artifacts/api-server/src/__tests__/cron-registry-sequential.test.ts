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

type CronRegistry = typeof import("../services/cron-registry");
let registerRunnableCron: CronRegistry["registerRunnableCron"];
let runDueCrons: CronRegistry["runDueCrons"];

/**
 * Charge le registre avec le budget que CE test exige.
 *
 * Le fichier fixait auparavant un budget unique de 50 ms pour les trois tests.
 * Or ils ne demandent pas la meme chose, et demandent meme le contraire:
 *
 *   - l'enchainement veut un budget PLUS GRAND que le travail simule (30 ms),
 *     sinon la derniere tache est reportee et le test echoue;
 *   - le report veut un budget PLUS PETIT que la premiere tache (120 ms).
 *
 * A 50 ms, la premiere condition ne tenait qu'a vingt millisecondes de marge —
 * c'est-a-dire au hasard de la charge de la machine. En integration continue,
 * elle a fini par ceder: `gamma` reporte, `triggered` incomplet, et un
 * echec sans rapport avec la modification proposee.
 *
 * Le commentaire de ce fichier disait deja pourquoi c'est grave: un test
 * intermittent dans une porte de qualite bloque des deploiements au hasard et
 * finit par etre ignore. Il l'etait pour une AUTRE cause; le voici pour
 * celle-ci.
 *
 * Chaque test choisit donc son budget, avec une marge d'un ordre de grandeur
 * de chaque cote. Plus rien ne depend de la vitesse de la machine.
 */
async function chargerLeRegistre(budgetMs: number): Promise<void> {
  process.env.CRON_TICK_BUDGET_MS = String(budgetMs);
  // Le module lit le budget A L'IMPORT: il faut donc le reimporter apres
  // l'avoir pose, et non l'inverse.
  vi.resetModules();
  ({ registerRunnableCron, runDueCrons } = await import("../services/cron-registry"));
}

/** Confortable: le travail simule tient trente fois dedans. */
const BUDGET_LARGE = 1000;
/** Serre: la premiere tache (120 ms) le depasse a coup sur. */
const BUDGET_SERRE = 20;

describe("runDueCrons", () => {
  beforeEach(() => {
    heartbeats.length = 0;
    // Le registre est un Map de portee module, et rien ne le vide. Sans ce
    // reimport, les taches inscrites par un test restaient dues dans le
    // suivant: elles consommaient le budget de 50 ms avant que la tache du
    // test lui-meme ne soit atteinte, qui se retrouvait alors REPORTEE et
    // jamais executee. Selon la vitesse de la machine, ces tests passaient ou
    // echouaient — un test intermittent dans une porte de qualite bloque des
    // deploiements au hasard et finit par etre ignore.
  });

  it("enchaine les taches dues au lieu de les lancer en parallele", async () => {
    await chargerLeRegistre(BUDGET_LARGE);
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
    await chargerLeRegistre(BUDGET_LARGE);
    const done: string[] = [];
    registerRunnableCron("boom", 1000, async () => { throw new Error("panne"); });
    registerRunnableCron("apres", 1000, async () => { done.push("apres"); });

    await runDueCrons();

    expect(done).toContain("apres");
  });

  it("reporte les taches qui depassent le budget au lieu de faire expirer le declencheur", async () => {
    await chargerLeRegistre(BUDGET_SERRE);
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
