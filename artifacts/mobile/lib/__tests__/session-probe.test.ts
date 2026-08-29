/**
 * Verdict de la sonde de session (`lib/session-probe.ts`).
 *
 * C'est la seule chose qui separe "l'utilisateur reste connecte" de "retour a
 * l'ecran de connexion". `AuthContext` traitait auparavant tout statut non-2xx,
 * et toute erreur reseau, comme un jeton revoque. Deux consequences reelles:
 *
 *  - demarrage sans reseau: l'utilisateur etait renvoye vers un ecran de
 *    connexion qu'il ne pouvait pas utiliser, faute de reseau. L'application
 *    entretient pourtant un cache hors ligne, rendu inaccessible des le
 *    premier redemarrage;
 *  - 503 pendant un deploiement: tout le parc mobile deconnecte d'un coup,
 *    avec purge du cache metier de chaque appareil.
 *
 * Regle figee ici: seul un refus d'authentification explicite condamne la
 * session.
 */
import { describe, it, expect } from "vitest";
import { classifySessionProbe } from "../session-probe";

describe("verdict de la sonde de session", () => {
  it("accepte les reponses 2xx", () => {
    for (const status of [200, 204, 299]) {
      expect(classifySessionProbe(status)).toBe("valid");
    }
  });

  it("ne condamne la session que sur 401 et 403", () => {
    expect(classifySessionProbe(401)).toBe("revoked");
    expect(classifySessionProbe(403)).toBe("revoked");
  });

  it("traite une panne serveur comme un verdict impossible", () => {
    // Regression: un deploiement en cours deconnectait tout le parc.
    for (const status of [500, 502, 503, 504]) {
      expect(classifySessionProbe(status), `HTTP ${status}`).toBe("unavailable");
    }
  });

  it("traite une limitation de debit comme un verdict impossible", () => {
    expect(classifySessionProbe(429)).toBe("unavailable");
  });

  it("traite l'absence de reponse comme un verdict impossible", () => {
    // `null` = fetch a leve: pas de reseau, DNS, timeout.
    expect(classifySessionProbe(null)).toBe("unavailable");
  });

  it("ne condamne pas la session sur un 404 de route", () => {
    // Une route momentanement absente (deploiement partiel, proxy mal route)
    // ne dit rien de la validite du jeton.
    expect(classifySessionProbe(404)).toBe("unavailable");
  });
});
