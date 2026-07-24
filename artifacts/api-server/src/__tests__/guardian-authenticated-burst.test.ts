/**
 * Regression: une session authentifiee ne doit pas etre prise pour un bot.
 *
 * Le tableau de bord ouvre en parallele de nombreux widgets (smart-pulse,
 * recent-activity, anomaly-stream, flux SSE...). Avec le seuil unique de
 * 50 requetes/10 s, une simple ouverture de page declenchait la detection
 * "bot davranisi"; quatre rafales suffisaient a bannir l'adresse et l'
 * utilisateur se retrouvait en 403 sur toute l'application (observe en
 * production le 2026-07-24 avec un navigateur Chrome reel).
 *
 * Cette suite verrouille les deux moities du compromis :
 *   1. un visiteur ANONYME qui depasse le seuil est toujours detecte ;
 *   2. le meme volume, envoye par un utilisateur CONNECTE, ne l'est pas.
 */
import { describe, expect, it } from "vitest";
import { detectBehavioralAnomaly, recordRequest } from "../middleware/guardian";

/** Simule `n` requetes provenant d'une meme IP, sur des chemins d'application. */
function burst(ip: string, n: number): void {
  for (let i = 0; i < n; i++) {
    recordRequest(ip, `/api/dashboard/widget-${i % 8}`);
  }
}

describe("guardian — rafales et sessions authentifiees", () => {
  it("detecte une rafale anonyme au-dela du seuil", () => {
    const ip = "203.0.113.10";
    burst(ip, 130);
    expect(detectBehavioralAnomaly(ip, false)).toMatch(/istek/);
  });

  it("laisse passer la meme rafale pour un utilisateur connecte", () => {
    const ip = "203.0.113.11";
    // Volume representatif d'une ouverture de tableau de bord: bien au-dessus
    // du seuil anonyme (50/10 s), bien en dessous du budget authentifie.
    burst(ip, 130);
    expect(detectBehavioralAnomaly(ip, true)).toBeNull();
  });

  it("finit par detecter un volume aberrant meme authentifie", () => {
    const ip = "203.0.113.12";
    // Le relevement du budget ne doit pas equivaloir a une exemption: un
    // compte compromis qui martele l'API reste reperable.
    burst(ip, 2000);
    expect(detectBehavioralAnomaly(ip, true)).toMatch(/istek/);
  });

  it("isole les profils par adresse", () => {
    const noisy = "203.0.113.13";
    const quiet = "203.0.113.14";
    burst(noisy, 130);
    burst(quiet, 3);
    expect(detectBehavioralAnomaly(noisy, false)).toMatch(/istek/);
    expect(detectBehavioralAnomaly(quiet, false)).toBeNull();
  });
});
