/**
 * Une coupure de connexion ne doit pas tuer le cycle du super-agent.
 *
 * Mesure sur sept jours de journaux de production, avant correction:
 *
 *     « [SuperAgentCron] erreur du cycle »            42
 *     « [SuperAgentCron] echec pour une organisation »  0
 *     « aucune identite disponible »                    0
 *
 * Quarante-deux cycles morts sur la PREMIERE requete, toujours sur
 * « Connection terminated ». Zero echec par organisation: le cycle
 * n'atteignait donc jamais le travail qu'il est cense faire.
 *
 * La cause n'etait pas la base. Le cron enveloppe deja SES propres requetes
 * dans `withDbRetry`; le module d'etat qu'il appelle n'en enveloppait AUCUNE
 * — dix requetes, zero protection. La protection s'arretait exactement a la
 * frontiere du module, et la requete d'entree, celle par laquelle tout
 * commence, etait du mauvais cote.
 *
 * C'est le motif qui revient dans ce depot: une regle connue, appliquee d'un
 * cote seulement. Et une panne etiquetee « transitoire » qui se produit un
 * cycle sur deux n'est plus transitoire — l'etiquette empeche seulement de la
 * regarder.
 *
 * Le test verifie les deux sens, car reessayer n'importe quoi serait pire:
 * une erreur SQL doit echouer du premier coup, sans rejouer une ecriture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { withDbRetry } from "../lib/db-retry";

function coupure(): Error {
  // La forme exacte vue en production.
  return new Error("Connection terminated due to connection timeout");
}

describe("la politique de reessai", () => {
  it("rejoue une coupure de connexion et finit par reussir", async () => {
    let appels = 0;
    const resultat = await withDbRetry(async () => {
      appels++;
      if (appels < 2) throw coupure();
      return "ok";
    }, { baseDelayMs: 1 });

    expect(resultat).toBe("ok");
    expect(appels).toBe(2);
  });

  it("ne rejoue PAS une erreur SQL", async () => {
    // Rejouer une contrainte violee ne la satisferait pas davantage, et
    // rejouer une ecriture peut la dupliquer.
    let appels = 0;
    await expect(
      withDbRetry(async () => {
        appels++;
        throw new Error('duplicate key value violates unique constraint "factures_reference_key"');
      }, { baseDelayMs: 1 }),
    ).rejects.toThrow(/duplicate key/);

    expect(appels, "une erreur SQL a ete rejouee").toBe(1);
  });

  it("abandonne apres ses tentatives plutot que de boucler", async () => {
    let appels = 0;
    await expect(
      withDbRetry(async () => { appels++; throw coupure(); }, { attempts: 3, baseDelayMs: 1 }),
    ).rejects.toThrow(/Connection terminated/);

    expect(appels).toBe(3);
  });
});

describe("le module d'etat du super-agent", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "services", "super-agent-state.ts"),
    "utf8",
  );

  it("fait passer ses requetes par le reessai", () => {
    expect(
      /return await withDbRetry\(\(\) => fn\(\)\)/.test(source),
      "les requetes du module ne sont plus protegees: le cycle remourra sur la premiere coupure",
    ).toBe(true);
  });

  it("garde le repli « tables absentes » distinct du reessai", () => {
    // Une table absente ne se repare pas en reessayant: elle doit continuer a
    // tomber dans le repli, qui dit quoi faire (pousser le schema).
    expect(source).toContain("isUndefinedTable(err)");
    expect(source).toMatch(/gcp-schema-push\.sh/);
  });

  it("le cron appelant protegeait deja les siennes", () => {
    // Contre-epreuve de portee: si le cron ne l'avait pas fait non plus, le
    // defaut serait une absence de regle, pas une regle mal appliquee — et la
    // correction devrait porter ailleurs.
    const cron = readFileSync(
      join(import.meta.dirname, "..", "services", "super-agent-cron.ts"),
      "utf8",
    );
    expect((cron.match(/withDbRetry/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
