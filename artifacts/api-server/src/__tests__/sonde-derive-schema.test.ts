/**
 * La sonde de derive de schema, eprouvee contre une VRAIE base.
 *
 * Elle existe parce que le cas s'est produit et est reste invisible trente-six
 * heures: la poussee du schema en production est manuelle — la chaine de
 * deploiement ne pousse que la base de CI — et une fusion est partie sans
 * elle. `tasks.created_by_agent` manquait; le moteur d'automatisation echouait
 * toutes les cinq minutes; mille onze erreurs se sont accumulees dans les
 * journaux sans que rien, dans le produit, ne le dise.
 *
 * Aucune autre sonde ne pouvait l'attraper: la base repondait, la latence
 * etait bonne, le pool respirait. C'est le propre de cette panne — elle ne
 * degrade rien, elle supprime une fonctionnalite en silence.
 *
 * Deux verifications, et la seconde compte autant que la premiere:
 *
 *   - une colonne retiree de la base doit etre SIGNALEE, en la nommant;
 *   - une base conforme doit rester SILENCIEUSE. Une sonde qui crie sur une
 *     installation saine serait desactivee dans la semaine, et ne servirait
 *     alors plus a rien le jour ou elle aurait raison.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { HEALTH_AGENTS } from "../services/health-agents";

/** Colonne sacrifiee: nullable et sans index, donc reconstructible a l'identique. */
const TABLE = "tasks";
const COLONNE = "created_by_agent";

async function sonder() {
  const agent = HEALTH_AGENTS.find((a) => a.id === "database");
  if (!agent) throw new Error("agent 'database' introuvable");
  const resultats = await agent.run();
  const derive = resultats.find((r) => r.check === "schema_drift");
  if (!derive) throw new Error("la sonde schema_drift n'a pas ete executee");
  return derive;
}

async function remettreLaColonne() {
  await db.execute(
    sql.raw(`ALTER TABLE "${TABLE}" ADD COLUMN IF NOT EXISTS "${COLONNE}" text`),
  );
}

afterAll(remettreLaColonne);

describe("la sonde de derive de schema", () => {
  it("se tait quand la base correspond au code", async () => {
    await remettreLaColonne();
    const verdict = await sonder();

    expect(verdict.status, verdict.summary).toBe("ok");
    // Le nombre de colonnes comparees est la preuve que la comparaison a bien
    // eu lieu: un "ok" obtenu sur un ensemble vide ne vaudrait rien.
    expect(Number(verdict.metrics?.attendues ?? 0)).toBeGreaterThan(100);
    expect(Number(verdict.metrics?.manquantes ?? -1)).toBe(0);
  });

  it("signale une colonne que le code attend et que la base n'a pas", async () => {
    // On reproduit exactement la panne de production: le code declare la
    // colonne, la base ne l'a pas.
    await db.execute(sql.raw(`ALTER TABLE "${TABLE}" DROP COLUMN IF EXISTS "${COLONNE}"`));
    try {
      const verdict = await sonder();

      expect(verdict.status).toBe("echec");
      expect(verdict.severity).toBe("critique");
      // Nommer la colonne est ce qui rend l'alerte actionnable: « schema
      // incoherent » n'aurait dit a personne quoi pousser.
      expect(verdict.summary).toContain(`${TABLE}.${COLONNE}`);
      // Et dire QUOI FAIRE: la panne a dure parce que personne ne savait que
      // la poussee manquait, pas parce que la commande etait difficile.
      expect(verdict.remediation).toContain("gcp-schema-push.sh");
      expect(Number(verdict.metrics?.manquantes ?? 0)).toBeGreaterThan(0);
    } finally {
      await remettreLaColonne();
    }
  });
});
