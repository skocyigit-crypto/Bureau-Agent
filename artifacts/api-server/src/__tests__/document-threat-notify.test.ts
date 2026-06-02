/**
 * Tâche #134 — dédup des notifications de menace documentaire.
 *
 * La notification push mobile sur scan « dangerous » est dédupliquée *par
 * document* via la transition de verdict (et non agrégée au niveau org comme
 * la suggestion proactive). Ces tests verrouillent la règle exigée :
 *   - un premier document dangereux notifie ;
 *   - un second document distinct devenu dangereux notifie aussi ;
 *   - re-scanner un document déjà « dangerous » ne re-notifie pas.
 */
import { describe, expect, it } from "vitest";

import { shouldNotifyDocumentThreat } from "../services/proactive-engine";

describe("shouldNotifyDocumentThreat", () => {
  it("notifie un document jamais scanné qui devient dangereux", () => {
    // Premier scan d'un nouveau fichier (verdict précédent absent).
    expect(shouldNotifyDocumentThreat(null, "dangerous")).toBe(true);
    expect(shouldNotifyDocumentThreat(undefined, "dangerous")).toBe(true);
  });

  it("notifie un document jusque-là sain qui devient dangereux", () => {
    expect(shouldNotifyDocumentThreat("safe", "dangerous")).toBe(true);
  });

  it("notifie chaque document distinct devenu dangereux (pas de dédup org-wide)", () => {
    // Deux fichiers différents, chacun avec son propre verdict précédent : les
    // deux doivent notifier, contrairement à une dédup agrégée au niveau org.
    const docA = shouldNotifyDocumentThreat(null, "dangerous");
    const docB = shouldNotifyDocumentThreat("safe", "dangerous");
    expect(docA).toBe(true);
    expect(docB).toBe(true);
  });

  it("ne re-notifie pas un re-scan d'un document déjà dangereux", () => {
    expect(shouldNotifyDocumentThreat("dangerous", "dangerous")).toBe(false);
  });

  it("ne notifie pas un verdict sain", () => {
    expect(shouldNotifyDocumentThreat(null, "safe")).toBe(false);
    expect(shouldNotifyDocumentThreat("dangerous", "safe")).toBe(false);
  });
});
