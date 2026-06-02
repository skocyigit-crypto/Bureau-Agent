/**
 * Tache #169 — confirmer cote UI mobile que « arreter un scan » fonctionne.
 *
 * Les tests serveur (document-scan-job / cancel-endpoint) prouvent deja que le
 * job s'arrete proprement. Ce qui restait non couvert cote mobile, c'est la
 * logique qui pilote l'ecran : quel endpoint d'annulation appeler selon le mode
 * (bulkScanKind), quand afficher le bouton « Annuler » du scan « Tout
 * analyser », et quand une demande d'annulation est valable. Une regression ici
 * reintroduirait le ressenti « je clique stop mais rien ne se passe » meme avec
 * un backend correct. handleScanAll/handleCancelBulkScan/pollBulkScan dans
 * app/documents.tsx s'appuient sur ces decisions pures.
 */
import { describe, it, expect } from "vitest";
import {
  bulkScanCancelEndpoint,
  showAllScanCancel,
  canRequestCancel,
} from "../bulk-scan";

describe("bulkScanCancelEndpoint — choix de l'endpoint selon le mode", () => {
  it("scan « Tout analyser » (all) -> endpoint du job en arriere-plan", () => {
    expect(bulkScanCancelEndpoint("all")).toBe("/api/documents/scan-unscanned/cancel");
  });

  it("scan d'une selection (selected) -> endpoint du flux SSE", () => {
    expect(bulkScanCancelEndpoint("selected")).toBe("/api/documents/bulk/scan/cancel");
  });

  it("aucun scan (null) -> aucun endpoint", () => {
    expect(bulkScanCancelEndpoint(null)).toBeNull();
  });
});

describe("showAllScanCancel — visibilite du bouton « Annuler » (Tout analyser)", () => {
  it("visible uniquement pendant le scan « Tout analyser »", () => {
    expect(showAllScanCancel({ bulkScanning: true, bulkScanKind: "all" })).toBe(true);
  });

  it("masque quand aucun scan ne tourne", () => {
    expect(showAllScanCancel({ bulkScanning: false, bulkScanKind: "all" })).toBe(false);
    expect(showAllScanCancel({ bulkScanning: false, bulkScanKind: null })).toBe(false);
  });

  it("masque pendant un scan de selection (pas « Tout analyser »)", () => {
    expect(showAllScanCancel({ bulkScanning: true, bulkScanKind: "selected" })).toBe(false);
  });
});

describe("canRequestCancel — l'app revient a l'etat inactif apres annulation", () => {
  it("autorise l'annulation quand un scan tourne et qu'on n'annule pas deja", () => {
    expect(canRequestCancel({ bulkScanning: true, bulkScanCancelling: false })).toBe(true);
  });

  it("refuse un second clic pendant l'arret en cours", () => {
    expect(canRequestCancel({ bulkScanning: true, bulkScanCancelling: true })).toBe(false);
  });

  it("no-op quand plus aucun scan ne tourne (retour a l'etat inactif)", () => {
    expect(canRequestCancel({ bulkScanning: false, bulkScanCancelling: false })).toBe(false);
  });
});
