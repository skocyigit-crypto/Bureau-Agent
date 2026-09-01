import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

/**
 * Un recours jamais appele n'est pas un recours en bonne sante.
 *
 * L'etat des fournisseurs n'etait connu que par les appels reels. Or la
 * bascule s'arrete au PREMIER qui repond: tant que celui-la tient, les
 * suivants ne sont jamais appeles, donc jamais evalues — et « jamais evalue »
 * se presentait comme « disponible ».
 *
 * Constate le 1er septembre 2026: Gemini ET OpenAI etaient sans credits,
 * Anthropic portait seul tout le service, et la surveillance annoncait
 * « aucune indisponibilite ». L'application se croyait deux recours alors
 * qu'il ne lui en restait aucun. La panne d'OpenAI n'a ete decouverte qu'en
 * appelant l'API a la main.
 *
 * C'est le pire mode de panne d'un dispositif de secours: il ne se manifeste
 * qu'au moment ou on en a besoin.
 */

const calls = vi.hoisted(() => ({ gemini: 0, anthropic: 0, openai: 0 }));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: async () => {
        calls.gemini += 1;
        throw Object.assign(new Error("Your prepayment credits are depleted."), { status: 429 });
      },
    },
  },
}));

const failover = await import("../services/ai-failover");

afterEach(() => {
  calls.gemini = 0;
  calls.anthropic = 0;
  calls.openai = 0;
  delete process.env.AI_PROVIDER_PROBE;
});

// Ce bloc doit passer AVANT toute sonde: il decrit l'etat vierge, celui d'un
// fournisseur que rien n'a encore appele. Une fois sonde, l'etat n'est plus
// vierge et la distinction testee ici n'existe plus.
describe("etat vierge", () => {
  it("distingue « jamais appele » de « disponible »", () => {
    // Avant correction, les deux se ressemblaient: `failing: false` et
    // `failures: 0`. C'est cette confusion qui a fait compter un fournisseur
    // mort parmi les recours disponibles.
    const openai = failover.providerHealth().find((s) => s.provider === "openai");

    expect(openai?.failing, "etat initial inattendu").toBe(false);
    expect(
      openai?.lastSeenMs,
      "un fournisseur jamais appele doit etre reconnaissable comme tel",
    ).toBeNull();
  });
});

describe("sonde des fournisseurs", () => {
  it("appelle ceux dont on ne sait rien", async () => {
    // Aucun appel reel n'a eu lieu: les trois sont inconnus, donc tous
    // sondes. C'est le seul moyen d'apprendre l'etat d'un recours qui n'est
    // jamais sollicite.
    const sondes = await failover.probeStaleProviders();

    expect(sondes).toContain("gemini");
    expect(sondes.length, "tous les fournisseurs inconnus doivent etre sondes").toBe(3);
    expect(calls.gemini, "le fournisseur n'a pas ete reellement appele").toBeGreaterThan(0);
  });

  it("retient l'echec constate, au lieu de laisser le fournisseur passer pour sain", async () => {
    await failover.probeStaleProviders();

    const gemini = failover.providerHealth().find((s) => s.provider === "gemini");
    expect(gemini?.failing, "un refus constate par la sonde n'a pas ete retenu").toBe(true);
    expect(gemini?.reason ?? "").toMatch(/credits/i);
  });

  it("cesse de sonder un fournisseur dont l'etat est frais", async () => {
    // Payer pour reapprendre ce qu'on sait deja n'aurait pas de sens: c'est
    // ce qui rend le cout de cette sonde negligeable.
    await failover.probeStaleProviders();
    const apresPremierTour = calls.gemini;

    const sondes = await failover.probeStaleProviders();

    expect(sondes, "un fournisseur frais a ete resonde").toEqual([]);
    expect(calls.gemini).toBe(apresPremierTour);
  });

  it("peut etre coupee entierement", async () => {
    // La sonde depense de l'argent: il doit exister un interrupteur.
    process.env.AI_PROVIDER_PROBE = "off";

    const sondes = await failover.probeStaleProviders();

    expect(sondes).toEqual([]);
    expect(calls.gemini).toBe(0);
  });
});
