import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Relances de paiement: le meme client ne doit pas etre relance deux fois.
 *
 * Le detecteur de services/payment-reminder.ts promet en toutes lettres de
 * « ne JAMAIS marteler le meme client ». Il tient cette promesse en lisant
 * `factures_client.lastReminderAt`: une facture relancee recemment n'est pas
 * re-proposee avant MIN_INTERVAL_DAYS.
 *
 * Cet espacement ne vaut donc que si CHAQUE chemin d'envoi inscrit la relance
 * la ou le detecteur regarde. Ce n'etait pas le cas: l'assistant
 * (POST /ai/execute, action `send_payment_reminder`) envoyait un rappel de
 * paiement et ne l'ecrivait que sur `compte_client`. La relance restait
 * invisible pour le detecteur, qui pouvait en proposer une seconde des le
 * lendemain — le martelement precis que le module dit eviter.
 *
 * Ces tests figent le contrat: envoyer une relance, c'est l'inscrire sur les
 * factures concernees. Ils sont statiques parce qu'ils gardent une invariante
 * entre deux fichiers que rien n'oblige autrement a rester d'accord.
 */

const SRC = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const detector = read("services/payment-reminder.ts");
const proactive = read("routes/proactive.ts");
const aiAnalysis = read("routes/ai-analysis.ts");

/** Corps du `case "send_payment_reminder"` de POST /ai/execute. */
const assistantCase = (() => {
  const start = aiAnalysis.indexOf('case "send_payment_reminder": {');
  expect(start, "case send_payment_reminder introuvable").toBeGreaterThan(-1);
  return aiAnalysis.slice(start, aiAnalysis.indexOf('case "account_health_check"', start));
})();

describe("detecteur de relances", () => {
  it("n'envoie jamais lui-meme", () => {
    // La regle d'or du module: il depose une suggestion, l'envoi appartient a
    // l'humain. Un import d'envoi ici la retirerait sans bruit.
    expect(detector).not.toMatch(/\bsendEmail\s*\(/);
    expect(detector).not.toMatch(/\bsendSms\s*\(/);
    expect(detector).toMatch(/aucun envoi autonome/i);
  });

  it("espace les relances a partir de la facture", () => {
    expect(detector).toContain("MIN_INTERVAL_DAYS");
    expect(detector).toMatch(/lastReminderAt/);
  });
});

describe("chaque chemin d'envoi inscrit la relance sur la facture", () => {
  it("la route d'approbation le fait", () => {
    const tail = proactive.slice(proactive.indexOf("send-reminder"));
    expect(tail).toMatch(/update\(facturesClientTable\)/);
    expect(tail).toMatch(/lastReminderAt/);
  });

  it("l'assistant le fait aussi", () => {
    // La regression exacte: seul `compte_client` etait mis a jour.
    expect(assistantCase).toMatch(/update\(facturesClientTable\)/);
    expect(assistantCase).toMatch(/lastReminderAt: remindedAt/);
  });

  it("l'assistant ne relance que les factures echues et recouvrables", () => {
    // Marquer une facture payee ou annulee comme relancee fausserait le
    // compteur et l'historique du client.
    expect(assistantCase).toContain("NON_COLLECTIBLE_STATUSES");
    expect(assistantCase).toMatch(/lt\(facturesClientTable\.dueDate/);
    expect(assistantCase).toMatch(/totalAmount\} - \$\{facturesClientTable\.paidAmount\}\) > 0/);
  });

  it("reste borne a l'organisation et au client", () => {
    expect(assistantCase).toMatch(/eq\(facturesClientTable\.organisationId, orgId\)/);
    expect(assistantCase).toMatch(/eq\(facturesClientTable\.contactId, acct\.contactId\)/);
  });
});

describe("statuts non recouvrables", () => {
  it("n'ont qu'une seule definition", () => {
    // Deux listes divergentes rejoueraient le meme desaccord entre chemins.
    const files = ["services/payment-reminder.ts", "routes/ai-analysis.ts", "routes/proactive.ts"];
    const literals = files.flatMap((f) => [...read(f).matchAll(/\["brouillon",\s*"payee",\s*"annulee"\]/g)]);
    expect(literals).toHaveLength(1);
    expect(detector).toMatch(/export const NON_COLLECTIBLE_STATUSES/);
  });
});
