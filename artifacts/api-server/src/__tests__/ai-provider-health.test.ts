import { describe, expect, it, vi, beforeEach } from "vitest";

// Meme amorce que health-alert-selection.test.ts: le module d'alerte importe
// la base a son chargement, alors que rien ici ne l'interroge. Une URL factice
// suffit a le laisser se charger.
vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { selectAlertableChecks } from "../services/health-alert";

/**
 * Prevenir avant la coupure, sans crier pour rien.
 *
 * Le 1er septembre 2026, les credits Gemini epuises ont arrete toutes les
 * fonctions IA. Personne n'a ete prevenu: la panne a ete decouverte parce
 * qu'une personne a remarque que l'assistant ne repondait plus. Aucun agent de
 * sante ne surveillait ce domaine.
 *
 * La bascule automatique posee depuis masque la panne pour l'utilisateur — ce
 * qui rend la surveillance plus necessaire, pas moins: la depense glisse vers
 * un fournisseur plus cher et le recours s'amenuise en silence.
 *
 * Reste a doser. `selectAlertableChecks` n'envoie un e-mail que sur
 * `echec` + `haute|critique`, une regle volontairement etroite pour eviter le
 * bruit. Un fournisseur perdu sur trois n'est pas une urgence: l'application
 * fonctionne. Mais quand il n'en reste qu'un, la panne suivante coupe tout —
 * et cette alerte-la doit partir.
 */

const health = vi.hoisted(() => ({ states: [] as any[] }));

vi.mock("../services/ai-failover", () => ({
  providerHealth: () => health.states,
  // L'agent sonde avant de lire, sinon il affirmerait une disponibilite qu'il
  // n'a pas verifiee. Ici les etats sont fournis directement: la sonde n'a
  // rien a apprendre et ne doit surtout pas appeler de fournisseur.
  probeStaleProviders: async () => [],
}));

const { HEALTH_AGENTS } = await import("../services/health-agents");

const agent = HEALTH_AGENTS.find((a) => a.id === "ai_providers")!;

function state(provider: string, failing: boolean, reason?: string) {
  return { provider, failing, sinceMs: failing ? 60_000 : null, reason: failing ? (reason ?? "429") : null, failures: failing ? 3 : 0 };
}

/** Reproduit ce que le cron fait des resultats avant d'envoyer un e-mail. */
async function runAndSelect() {
  const results = await agent.run();
  return {
    result: results[0]!,
    alerte: selectAlertableChecks(results.map((r) => ({ ...r, agent: agent.id }))),
  };
}

beforeEach(() => {
  health.states = [];
});

describe("agent de sante des fournisseurs IA", () => {
  it("existe (il n'existait pas le jour de la panne)", () => {
    expect(agent).toBeTruthy();
    expect(agent.name).toMatch(/IA/i);
  });

  it("se tait quand tout va bien", async () => {
    health.states = [state("gemini", false), state("anthropic", false), state("openai", false)];
    const { result, alerte } = await runAndSelect();
    expect(result.status).toBe("ok");
    expect(alerte).toHaveLength(0);
  });

  it("signale sans alerter quand un seul fournisseur est tombe", async () => {
    // Exactement la situation du 1er septembre une fois la bascule en place:
    // l'application repond normalement. Envoyer un e-mail ici serait du bruit,
    // mais l'etat doit rester visible dans le panneau.
    health.states = [
      state("gemini", true, "Your prepayment credits are depleted"),
      state("anthropic", false),
      state("openai", false),
    ];
    const { result, alerte } = await runAndSelect();

    expect(result.status).toBe("degrade");
    expect(result.summary).toMatch(/gemini/);
    expect(result.summary).toMatch(/credits are depleted/);
    expect(alerte, "un fournisseur perdu sur trois ne doit pas declencher d'e-mail").toHaveLength(0);
  });

  it("ALERTE quand il ne reste qu'un fournisseur", async () => {
    // La prochaine panne coupe tout: c'est le dernier moment utile pour
    // prevenir, et l'e-mail doit reellement partir.
    health.states = [
      state("gemini", true, "credits depleted"),
      state("anthropic", true, "rate limit"),
      state("openai", false),
    ];
    const { result, alerte } = await runAndSelect();

    expect(result.status).toBe("echec");
    expect(result.severity).toBe("haute");
    expect(alerte, "il ne reste qu'un recours: l'e-mail doit partir").toHaveLength(1);
    expect(result.summary).toMatch(/un seul fournisseur/i);
  });

  it("passe en critique quand plus personne ne repond", async () => {
    health.states = [
      state("gemini", true, "credits depleted"),
      state("anthropic", true, "quota"),
      state("openai", true, "rate limit"),
    ];
    const { result, alerte } = await runAndSelect();

    expect(result.status).toBe("echec");
    expect(result.severity).toBe("critique");
    expect(alerte).toHaveLength(1);
  });

  it("dit quoi faire, pas seulement que ca va mal", async () => {
    // Une alerte sans remede laisse l'exploitant chercher.
    health.states = [state("gemini", true, "credits depleted"), state("anthropic", true, "quota"), state("openai", false)];
    const { result } = await runAndSelect();
    expect(result.remediation).toMatch(/recharger/i);
  });
});
