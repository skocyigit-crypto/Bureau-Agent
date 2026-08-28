/**
 * Regression : une panne de quota chez UN fournisseur ne doit pas couper le
 * conseil IA entier.
 *
 * `hedgedCouncil` interrompt toute la course des que `isQuotaErr(err)` est vrai.
 * L'intention est de s'arreter net quand l'ORGANISATION a depasse son budget IA
 * mensuel (`AiQuotaExceededError`, levee par `assertAiQuota`) : dans ce cas,
 * interroger un autre fournisseur ne ferait que depenser davantage.
 *
 * Le test portait sur la sous-chaine "quota" du message d'erreur, ce qui
 * confondait ce cas avec les erreurs de quota cote FOURNISSEUR — dont le
 * message contient lui aussi le mot. Chacune faisait donc echouer la requete
 * entiere alors que les autres fournisseurs repondaient : le hedging, dont le
 * seul but est d'absorber la panne d'un fournisseur, se retournait contre
 * lui-meme. `assertAiQuota` s'execute AVANT la construction du conseil, donc
 * `AiQuotaExceededError` ne peut de toute facon pas naitre dans une tentative.
 *
 * SUITE STATIQUE, deliberement. Importer `isQuotaErr` entrainerait la chaine
 * ai-commandant -> ai-quota -> lib/db, qui exige DATABASE_URL des l'import. Y
 * repondre par une URL factice avait un effet de bord mesure : vitest partage
 * `process.env` entre fichiers d'un meme worker, si bien que les suites a base
 * de donnees echouaient ensuite sur "Connection terminated unexpectedly" au
 * lieu de leur erreur d'import habituelle — des resultats non deterministes.
 * On verifie donc la propriete a la source, sans rien importer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const commandant = readFileSync(
  join(import.meta.dirname, "..", "routes/ai-commandant.ts"),
  "utf8",
);

/**
 * Messages reels releves en production. Ils partagent tous la sous-chaine
 * "quota" alors qu'ils designent des pannes de FOURNISSEUR, recuperables en
 * basculant sur le suivant.
 */
const PROVIDER_QUOTA_MESSAGES = [
  "Quota exceeded for aiplatform.googleapis.com/online_prediction_input_tokens_per_minute_per_base_model with base model: anthropic-claude-opus-4-8.",
  "Quota exceeded",
  "429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details.",
];

describe("conseil IA — interruption reservee au quota de l'organisation", () => {
  it("classe l'erreur par TYPE, pas par contenu du message", () => {
    expect(commandant).toContain(
      "return err instanceof AiQuotaExceededError;",
    );
  });

  it("n'utilise plus de correspondance par sous-chaine sur le message", () => {
    // C'est la forme exacte qui causait la panne ; la reintroduire ferait
    // retomber une erreur fournisseur dans le chemin « on arrete tout ».
    expect(commandant).not.toContain('includes("quota")');
    expect(commandant).not.toContain("includes('quota')");
  });

  it("interrompt le conseil uniquement via isQuotaErr", () => {
    // Verrouille le point d'entree : si un autre test d'erreur venait a
    // declencher `reject`, la distinction ci-dessus ne suffirait plus.
    expect(commandant).toContain("if (isQuotaErr(err)) { done = true;");
  });

  it("les messages fournisseurs piegeaient bien l'ancienne implementation", () => {
    // Documente pourquoi la sous-chaine etait un mauvais discriminant : ces
    // messages, tous recuperables, contiennent le mot "quota".
    const ancienPredicat = (message: string) =>
      message.toLowerCase().includes("quota");
    for (const message of PROVIDER_QUOTA_MESSAGES) {
      expect(ancienPredicat(message), message.slice(0, 48)).toBe(true);
    }
  });
});
