import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { cronLateAfterSec } from "../services/health-agents";

/**
 * A partir de quand une tache planifiee est declaree morte.
 *
 * Ce seuil decide du seul e-mail qui previent que le bureau a cesse
 * d'automatiser. Il peut echouer dans les deux sens, et les deux sont graves:
 *
 *   - trop haut, la panne reste inconnue;
 *   - trop bas, l'alerte part en fonctionnement normal, on apprend a la
 *     filtrer, et la vraie panne part avec elle.
 *
 * C'est le second qui s'est produit en production le 2026-09-01: une tache
 * "toutes les 15 min" declenchee par un battement de 10 min ne peut tourner
 * qu'aux multiples du battement, donc toutes les 20 min. L'ancien seuil (2x =
 * 30 min) ne laissait qu'un seul battement de marge; un deploiement a suffi a
 * creer un trou de 30 min et une fausse "panne d'automatisation" est partie
 * par e-mail alors que tout fonctionnait.
 */

const MIN = 60;

describe("seuil de retard", () => {
  it("laisse a une tache de 15 min la marge que le battement impose", () => {
    // Cadence reellement atteignable: 20 min. Un battement rate (30 min) ne
    // doit PAS alerter — c'est exactement le cas qui a produit la fausse
    // alerte.
    const seuil = cronLateAfterSec(15 * MIN, 10 * MIN);

    expect(seuil).toBeGreaterThan(30 * MIN);
    expect(seuil).toBe(40 * MIN);
  });

  it("finit tout de meme par declarer morte une tache de 15 min", () => {
    // La marge ne doit pas devenir un silence: deux battements rates suffisent
    // a alerter.
    const seuil = cronLateAfterSec(15 * MIN, 10 * MIN);

    expect(seuil).toBeLessThanOrEqual(45 * MIN);
  });

  it("ne relache jamais la surveillance existante", () => {
    // Le correctif ne doit qu'assouplir la ou le seuil etait intenable. Pour
    // tout intervalle, il reste au moins l'ancienne tolerance 2x — sinon on
    // aurait troque une fausse alerte contre une panne non detectee.
    for (const min of [1, 5, 10, 15, 20, 30, 60, 6 * 60, 24 * 60]) {
      const seuil = cronLateAfterSec(min * MIN, 10 * MIN);
      expect(seuil, `intervalle ${min} min`).toBeGreaterThanOrEqual(min * MIN * 2);
    }
  });

  it("garde le seuil des taches longues inchange", () => {
    // Une tache horaire ou quotidienne est deja un multiple du battement:
    // rien ne justifie de la toucher, et la durcir creerait des alertes
    // imprevues.
    expect(cronLateAfterSec(60 * MIN, 10 * MIN)).toBe(120 * MIN);
    expect(cronLateAfterSec(24 * 60 * MIN, 10 * MIN)).toBe(48 * 60 * MIN);
  });

  it("reste correct si le battement est plus lent que la tache", () => {
    // Battement de 10 min pour une tache "toutes les 5 min": elle ne tournera
    // jamais mieux que toutes les 10 min. Alerter a 10 min serait perpetuel.
    const seuil = cronLateAfterSec(5 * MIN, 10 * MIN);

    expect(seuil).toBeGreaterThan(10 * MIN);
    expect(seuil).toBe(30 * MIN);
  });

  it("retombe sur l'ancienne regle si le battement est inconnu", () => {
    // Une valeur absurde en configuration ne doit pas desarmer la sonde.
    expect(cronLateAfterSec(15 * MIN, 0)).toBe(30 * MIN);
    expect(cronLateAfterSec(15 * MIN, -1)).toBe(30 * MIN);
  });
});
