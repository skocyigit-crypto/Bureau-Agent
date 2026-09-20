/**
 * Invariants de facturation et de quota, lus sur la source.
 *
 * TROIS ASSERTIONS DE CE FICHIER NE PROUVAIENT RIEN. Elles sont corrigees
 * ici, et le pourquoi est ecrit a chaque endroit — un controle qu'on croit
 * solide est plus dangereux qu'un controle absent, parce qu'on cesse de
 * regarder ce qu'il couvre.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8");

/**
 * Le corps exact d'une route, accolades comptees.
 *
 * Remplace un `slice(indexOf(debut), indexOf(fin))`: si la route de fin passe
 * AVANT celle de debut — un simple reordonnancement, sans effet fonctionnel
 * puisque Express resout par methode et chemin — l'index de fin devient
 * inferieur a celui de debut et `slice` rend la chaine VIDE. Toutes les
 * assertions de ce bloc etant negatives (`not.toContain`), elles passaient
 * alors sur du vide, et l'IBAN du payeur pouvait repartir dans la reponse.
 */
function corpsDeLaRoute(source: string, declaration: string): string {
  const debut = source.indexOf(declaration);
  if (debut < 0) return "";
  let profondeur = 0;
  let ouvert = false;
  for (let i = debut; i < source.length; i++) {
    const c = source[i];
    if (c === "{") { profondeur++; ouvert = true; }
    else if (c === "}") {
      profondeur--;
      if (ouvert && profondeur === 0) return source.slice(debut, i + 1);
    }
  }
  return source.slice(debut);
}

describe("billing and quota security invariants", () => {
  it("includes internal unpaid invoices in cached access state", () => {
    const source = read("middleware/license-check.ts");
    expect(source).toContain("oldestUnpaidAt");
    expect(source).toContain("'en_attente', 'retard', 'partiel'");
    expect(source).toContain("evaluatePastDueAccess(oldestUnpaidAt");
  });

  it("invalidates access cache on every invoice payment path", () => {
    // ON REGARDE L'ARGUMENT, PAS LE NOMBRE D'APPELS.
    //
    // Cette assertion comptait les occurrences de `invalidateLicenseCache(`
    // et exigeait « au moins trois ». Le compte ne dit ni ou elles sont, ni
    // sur quoi elles portent: remplacer
    // `invalidateLicenseCache(invoice.organisationId)` par
    // `invalidateLicenseCache(req.session.organisationId)` dans un contexte
    // super-admin laissait le compte a trois — et l'organisation qui venait
    // de regler sa facture restait bloquee jusqu'a expiration du cache.
    const source = read("routes/billing.ts");
    const appels = [...source.matchAll(/invalidateLicenseCache\(([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(appels.length, "un chemin d'encaissement n'invalide plus le cache").toBeGreaterThanOrEqual(3);
    // L'invariant est que l'argument designe l'organisation FACTUREE, jamais
    // celle de l'appelant. Exiger le mot `organisationId` serait trop
    // etroit — `match.orgId` est parfaitement legitime — et un controle qui
    // crie au loup finit desactive.
    const suspects = appels.filter((a) => /req\.session|session\?\./.test(a));
    expect(
      suspects,
      `le cache est invalide pour l'appelant et non pour l'organisation facturee: ${suspects.join(", ")}`,
    ).toEqual([]);
    expect(
      appels.every((a) => a.length > 0),
      "invalidateLicenseCache() est appele sans argument",
    ).toBe(true);
  });

  it("does not return bank identity or raw payment rows", () => {
    const source = read("routes/billing.ts");
    const responseSection = corpsDeLaRoute(source, 'router.get("/billing/payments"');
    // Garde-fou: une fenetre vide ferait passer les quatre assertions
    // negatives ci-dessous sans rien garantir. C'est exactement ce qui
    // arrivait avec l'ancien decoupage.
    expect(responseSection.length, "la route /billing/payments est introuvable").toBeGreaterThan(200);
    expect(responseSection).toContain("res.json(");
    expect(responseSection).not.toContain("...r.payment");
    expect(responseSection).not.toContain("payerIban:");
    expect(responseSection).not.toContain("payerName:");
    expect(responseSection).not.toContain("rawLine:");
  });

  it("installs a database-level serialized user quota guard", () => {
    const source = read("services/ensure-user-quota.ts");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("users_enforce_organisation_quota");
    expect(source).toContain("user_quota_exceeded");
  });
});
