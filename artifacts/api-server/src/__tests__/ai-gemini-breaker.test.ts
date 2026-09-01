import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

/**
 * Le disjoncteur doit couper le chemin PRINCIPAL, pas seulement la chaine de
 * secours.
 *
 * Le client Gemini partage est appele directement par une soixantaine de
 * sites; son patch rattrape l'echec et delegue a la chaine de secours. Deux
 * consequences passaient inapercues, et les deux ont ete observees en
 * production le 1er septembre 2026, toute une journee durant:
 *
 *   1. La chaine de secours SAUTE Gemini — c'est lui qui vient d'echouer —
 *      donc elle ne le voyait jamais tomber. L'echec du fournisseur principal
 *      n'etait compte nulle part: le disjoncteur ne se declenchait jamais, et
 *      l'agent de sante affichait « Gemini en bonne sante » pendant toute une
 *      journee de panne. Aucune alerte n'est partie. C'est le defaut grave
 *      des deux: la bascule masque la panne pour l'utilisateur, ce qui est le
 *      but, mais alors plus rien ne la signale.
 *   2. Ce chemin part toujours sur Gemini, puisque c'est son client qui est
 *      appele. Meme un disjoncteur declenche n'empechait rien: chaque appel
 *      repayait un aller-retour dont le refus etait connu d'avance.
 */

const gemini = vi.hoisted(() => ({ calls: 0, fail: true }));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: async () => {
        gemini.calls += 1;
        // Refus reel observe en production, verifie en appelant l'API avec la
        // cle de production: le compte repond `429` en ~0,2 s.
        if (gemini.fail) {
          throw Object.assign(
            new Error("Your prepayment credits are depleted."),
            { status: 429 },
          );
        }
        return { text: "reponse de gemini" };
      },
    },
  },
}));

// La vraie machine a etats est conservee: c'est elle qu'on teste. Seule la
// sortie reseau est remplacee.
vi.mock("../services/ai-failover", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/ai-failover")>();
  return { ...real, generateContentFallback: vi.fn(async () => ({ text: "reponse de secours" })) };
});

const { installGeminiModelFallback } = await import("../services/ai-utils");
const failover = await import("../services/ai-failover");
const geminiModule = await import("@workspace/integrations-gemini-ai");

await installGeminiModelFallback();

const generate = () => (geminiModule as any).ai.models.generateContent({ model: "gemini-2.0-flash" });

describe("panne du fournisseur principal", () => {
  it("bascule, compte l'echec, puis cesse d'appeler le muet", async () => {
    expect(failover.isProviderTripped("gemini"), "etat initial deja declenche").toBe(false);

    // Trois echecs: le seuil qui distingue une panne installee d'un incident.
    for (let i = 0; i < 3; i += 1) {
      await expect(generate()).resolves.toEqual({ text: "reponse de secours" });
    }

    expect(
      failover.isProviderTripped("gemini"),
      "l'echec du fournisseur principal n'a pas ete compte",
    ).toBe(true);

    // A partir d'ici, plus AUCUN aller-retour vers Gemini: c'est ce qui rend
    // la bascule immediate au lieu de couter une expiration par appel.
    const callsAvantCourtCircuit = gemini.calls;
    await expect(generate()).resolves.toEqual({ text: "reponse de secours" });
    await expect(generate()).resolves.toEqual({ text: "reponse de secours" });

    expect(
      gemini.calls,
      "Gemini a ete rappele alors qu'il etait ecarte",
    ).toBe(callsAvantCourtCircuit);
  });

  it("sert toujours une reponse a l'appelant pendant la panne", async () => {
    // Le point de tout l'exercice: l'utilisateur ne doit rien voir.
    await expect(generate()).resolves.toHaveProperty("text");
  });
});
