/**
 * Un refus temporaire ne doit pas jeter l'utilisateur dehors.
 *
 * Le defaut, mesure le 2026-09-11 sur une application qui tournait: toute
 * reponse non-OK de `/api/auth/me` declenchait « votre session a expire pour
 * des raisons de securite ». L'application se limite elle-meme (429), donc un
 * utilisateur parfaitement authentifie se retrouvait devant un mur de
 * reconnexion JUSTE APRES s'etre connecte — quatorze 429 d'affilee dans la
 * mesure.
 *
 * Le cout n'est pas cosmetique: le mur remplace l'ecran en cours, donc ce que
 * la personne etait en train de saisir disparait. Et le defaut s'aggrave
 * lui-meme, puisque se reconnecter ajoute des requetes a celles qui ont
 * declenche la limite.
 */
import { describe, expect, it } from "vitest";

import { refusTemporaire, sessionVraimentPerdue } from "./session-status";

describe("ce qui signifie vraiment « session perdue »", () => {
  it("401 et 403 sont des reponses sur la session", () => {
    expect(sessionVraimentPerdue(401)).toBe(true);
    expect(sessionVraimentPerdue(403)).toBe(true);
  });

  it("429 n'en est pas une, et c'est tout l'objet de ce fichier", () => {
    // Le cas reel: l'application se limite elle-meme. Un bureau derriere une
    // seule adresse IP publique, ou plusieurs onglets ouverts, y suffit.
    expect(sessionVraimentPerdue(429)).toBe(false);
  });

  it("une panne du serveur ne dit rien de la session", () => {
    for (const statut of [500, 502, 503, 504]) {
      expect(sessionVraimentPerdue(statut), `${statut} ne doit pas deconnecter`).toBe(false);
    }
  });

  it("une reponse normale non plus", () => {
    // Garde-fou: une fonction qui rendrait `true` partout passerait les trois
    // premiers cas si on ne testait que des codes d'erreur.
    for (const statut of [200, 204, 304]) {
      expect(sessionVraimentPerdue(statut)).toBe(false);
    }
  });
});

describe("ce qui vaut la peine d'etre reessaye", () => {
  it("les refus temporaires le sont", () => {
    expect(refusTemporaire(429)).toBe(true);
    expect(refusTemporaire(500)).toBe(true);
    expect(refusTemporaire(503)).toBe(true);
  });

  it("un refus d'authentification ne l'est pas", () => {
    // Reessayer un 401 ne peut que produire un second 401: la seule issue est
    // de demander a l'utilisateur de se reconnecter.
    expect(refusTemporaire(401)).toBe(false);
    expect(refusTemporaire(403)).toBe(false);
  });

  it("les deux notions ne se recouvrent jamais", () => {
    // Si un statut etait a la fois « session perdue » et « a reessayer »,
    // l'ecran de connexion et la boucle de reprise se disputeraient l'affichage.
    for (let statut = 200; statut <= 599; statut++) {
      expect(
        sessionVraimentPerdue(statut) && refusTemporaire(statut),
        `${statut} ne peut pas etre les deux`,
      ).toBe(false);
    }
  });
});
