/**
 * Quels constats de sante reveillent le proprietaire de la plateforme.
 *
 * L'enjeu: c'est la seule alerte qui previent qu'un cron est mort, donc que le
 * bureau a cesse d'automatiser. Ce mode de panne est le plus dangereux d'un
 * produit "autonome" — rien ne casse, l'application repond normalement, les
 * ecrans sont juste vides — et il n'existe aucun autre signal exterieur.
 *
 * Les deux regressions possibles sont silencieuses et opposees:
 *   - trop large (les `degrade`, le bruit de fonctionnement normal) -> une
 *     alerte toutes les 15 minutes, qu'on finit par filtrer en boite mail, et
 *     la vraie panne passe avec les autres;
 *   - trop etroite -> on retombe sur le probleme d'origine, la panne n'est
 *     connue que de celui qui pense a ouvrir le panneau de sante.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { selectAlertableChecks } from "../services/health-alert";
import type { CheckResult } from "../services/health-agents";

function check(partial: Partial<CheckResult> & { check: string }): CheckResult & { agent: string } {
  return {
    agent: "scheduler",
    status: "ok",
    severity: "basse",
    summary: "résumé",
    ...partial,
  } as CheckResult & { agent: string };
}

describe("selectAlertableChecks", () => {
  it("alerte sur un cron mort (echec, severite haute)", () => {
    const selected = selectAlertableChecks([
      check({ check: "cron:invoice-reminder", status: "echec", severity: "haute" }),
    ]);
    expect(selected.map((c) => c.check)).toEqual(["cron:invoice-reminder"]);
  });

  it("alerte sur un echec critique", () => {
    const selected = selectAlertableChecks([
      check({ check: "db:pool", status: "echec", severity: "critique" }),
    ]);
    expect(selected).toHaveLength(1);
  });

  it("n'alerte pas sur un service simplement degrade", () => {
    // Un cron qui tourne mais a renvoye une erreur est deja visible dans le
    // panneau de sante et se resout souvent au cycle suivant.
    expect(selectAlertableChecks([
      check({ check: "cron:daily-digest", status: "degrade", severity: "haute" }),
    ])).toHaveLength(0);
  });

  it("n'alerte pas sur un etat inconnu", () => {
    // "Aucun battement enregistre" juste apres un deploiement est normal.
    expect(selectAlertableChecks([
      check({ check: "heartbeats_present", status: "inconnu", severity: "moyenne" }),
    ])).toHaveLength(0);
  });

  it("n'alerte pas sur un echec de faible severite", () => {
    expect(selectAlertableChecks([
      check({ check: "divers", status: "echec", severity: "moyenne" }),
    ])).toHaveLength(0);
  });

  it("ne retient que les constats alertables d'un cycle mixte", () => {
    const selected = selectAlertableChecks([
      check({ check: "cron:autonomous-secretary", status: "ok" }),
      check({ check: "cron:billing", status: "echec", severity: "haute" }),
      check({ check: "email:resend", status: "degrade", severity: "haute" }),
      check({ check: "db:latence", status: "echec", severity: "critique" }),
    ]);
    expect(selected.map((c) => c.check)).toEqual(["cron:billing", "db:latence"]);
  });

  it("ne retourne rien quand tout va bien", () => {
    expect(selectAlertableChecks([check({ check: "cron:billing" })])).toEqual([]);
  });
});
