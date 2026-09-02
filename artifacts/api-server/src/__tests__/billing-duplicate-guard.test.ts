import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { CRON_LOCK_NAMESPACE } from "../lib/cron-lock";

/**
 * Deux instances ne doivent pas facturer le meme mois deux fois.
 *
 * La generation verifie « une facture existe-t-elle deja pour cette
 * periode ? » par un SELECT, puis insere. Entre les deux, une autre instance
 * peut faire le meme constat et inserer aussi, et aucune contrainte d'unicite
 * ne rattrape: l'index unique de la table ne porte que sur l'identifiant
 * Stripe, absent des factures produites ici.
 *
 * La course n'est pas hypothetique. `startBillingCron` declenche un tick des
 * le demarrage — un rattrapage voulu, apres une interruption — et Cloud Run
 * demarre plusieurs instances a la fois pendant un deploiement (maxScale=3).
 * Le 2026-09-01, ce depot a connu une quinzaine de deploiements dans la
 * journee.
 *
 * Le resultat serait deux factures pour le meme mois sur le meme client. Une
 * erreur de facturation ne se voit pas dans les journaux: elle se voit sur le
 * releve du client.
 *
 * `withCronLock` existait deja pour ce motif exact — son propre commentaire
 * decrit ce schema SELECT-puis-ecriture — mais n'avait ete branche que sur
 * trois crons; la facturation, celui dont l'erreur coute le plus cher, avait
 * ete oubliee.
 */

const SRC = path.resolve(import.meta.dirname, "..");
const engine = fs.readFileSync(path.join(SRC, "services", "billing-engine.ts"), "utf8");

describe("generation des factures mensuelles", () => {
  it("prend un verrou avant de decider de facturer", () => {
    expect(engine).toContain("withCronLock(CRON_LOCK_NAMESPACE.billing");
  });

  it("verrouille par organisation, pas globalement", () => {
    // Un verrou global serialiserait toute la facturation et ferait sauter
    // les autres organisations des qu'une instance detient le verrou.
    expect(engine).toMatch(/withCronLock\(\s*CRON_LOCK_NAMESPACE\.billing,\s*org\.id/);
  });

  it("couvre le SELECT autant que l'INSERT", () => {
    // Verrouiller seulement l'ecriture ne servirait a rien: c'est l'intervalle
    // entre la lecture et l'ecriture qui est dangereux.
    const lockAt = engine.indexOf("withCronLock(CRON_LOCK_NAMESPACE.billing");
    const selectAt = engine.indexOf("eq(invoicesTable.periodLabel, periodLabel)");
    const insertAt = engine.indexOf("await db.insert(invoicesTable)");

    expect(lockAt).toBeGreaterThan(-1);
    expect(selectAt, "le controle d'existence doit etre DANS le verrou").toBeGreaterThan(lockAt);
    expect(insertAt, "l'insertion doit etre DANS le verrou").toBeGreaterThan(lockAt);
  });

  it("garde un espace de noms distinct des autres crons", () => {
    // Les identifiants d'entites sont de petits entiers sequentiels: un
    // espace partage ferait qu'un verrou « facturation org 1 » bloque un
    // verrou sans rapport « digest utilisateur 1 ».
    const values = Object.values(CRON_LOCK_NAMESPACE);

    expect(new Set(values).size, "espaces de noms en collision").toBe(values.length);
    expect(CRON_LOCK_NAMESPACE.billing).toBeTypeOf("number");
  });
});
