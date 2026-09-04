process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dependenciesAgent } from "../services/health-agents-external";

/**
 * L'absence de Stripe doit se LIRE.
 *
 * La sonde ne s'executait que si `STRIPE_SECRET_KEY` existait. Sans cle, elle
 * ne produisait aucune ligne — et un ecran de sante sans ligne se lit « rien a
 * signaler ». En production, le paiement par carte n'etait pas branche du tout
 * et rien ne le disait.
 *
 * Ce n'est pas une panne: c'est une configuration choisie, et la voie manuelle
 * marche. Mais le silence et le bon fonctionnement ne doivent pas se ressembler.
 */

const KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sonde Stripe", () => {
  it("dit explicitement que le paiement en libre-service est indisponible", async () => {
    const results = await dependenciesAgent.run();
    const stripe = results.find((r) => r.check === "stripe");

    expect(stripe, "aucune ligne Stripe: l'absence redevient invisible").toBeDefined();
    expect(stripe!.status).toBe("degrade");
    // Ce n'est pas une panne: la severite reste basse, sinon la sante passerait
    // au rouge pour un choix de configuration et plus personne ne la lirait.
    expect(stripe!.severity).toBe("basse");
    expect(stripe!.summary).toMatch(/libre-service/i);
    // La remediation doit nommer ce qu'il manque, pas dire « configurer Stripe ».
    expect(stripe!.remediation).toMatch(/STRIPE_SECRET_KEY/);
    expect(stripe!.remediation).toMatch(/STRIPE_PRICE_STARTER/);
  });

  it("mentionne la voie qui, elle, fonctionne", async () => {
    const results = await dependenciesAgent.run();
    const stripe = results.find((r) => r.check === "stripe");

    // Sans cette phrase, la ligne se lirait « on ne peut pas vendre », ce qui
    // est faux: la demande d'evolution cree une notification aux super-admins.
    expect(stripe!.summary).toMatch(/super-administrateurs/i);
  });
});
