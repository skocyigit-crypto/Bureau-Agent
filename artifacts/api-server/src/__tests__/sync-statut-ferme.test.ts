/**
 * `/sync/status` ne doit rien dire a qui n'est pas connecte, et rien dire des
 * AUTRES clients a qui l'est.
 *
 * L'etat d'avant, verifie en production: 200 sans session, avec
 * `totalConnections` — le nombre d'utilisateurs connectes sur toute la
 * plateforme, tous clients confondus.
 *
 * Aucun nom, aucun identifiant: c'est pourquoi le defaut a dure. Mais
 * interrogee chaque minute pendant un mois, cette route trace la courbe
 * d'activite de l'entreprise — heures de travail de la clientele, creux,
 * croissance. Pour une societe qu'on prepare a la vente, c'est exactement le
 * chiffre qu'un concurrent aimerait relever, et il etait offert a qui le
 * demandait.
 *
 * Le test porte sur la FORME du fichier plutot que sur une requete HTTP: cette
 * route est montee AVANT `requireAuth` (comme `/sync/events`, qui doit gerer
 * lui-meme sa session parce qu'un flux SSE ne se rejoue pas). Elle ne beneficie
 * donc d'aucune garde centrale, et c'est precisement ce qui l'avait laissee
 * ouverte: rien dans le montage ne la couvrait, rien dans le fichier ne la
 * fermait.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(import.meta.dirname, "..", "routes", "sync.ts"),
  "utf8",
);

/** Le corps du gestionnaire `/sync/status`, isole de ses voisins. */
function corpsDuStatut(): string {
  const debut = SOURCE.indexOf('router.get("/sync/status"');
  expect(debut, "le gestionnaire /sync/status est introuvable").toBeGreaterThan(-1);
  const suite = SOURCE.slice(debut);
  const fin = suite.indexOf("\n});");
  return suite.slice(0, fin > 0 ? fin : suite.length);
}

describe("/sync/status", () => {
  it("refuse une requete sans session", () => {
    const corps = corpsDuStatut();
    expect(
      /if \(!orgId\)[^\n]*401/.test(corps),
      "la route repond sans exiger de session: elle est montee avant requireAuth, " +
        "donc rien d'autre ne la protege",
    ).toBe(true);
  });

  it("ne rend le total de la plateforme qu'au super-administrateur", () => {
    const corps = corpsDuStatut();

    // Le total peut rester disponible — mais sous condition, jamais nu.
    if (corps.includes("totalConnections")) {
      expect(
        /super_admin/.test(corps),
        "totalConnections est rendu sans distinguer le super-administrateur: " +
          "un client verrait l'activite des autres clients",
      ).toBe(true);
    }
  });

  it("les deux autres routes du fichier exigent deja une session", () => {
    // Contre-epreuve de portee: si ces deux-la avaient ete ouvertes aussi, le
    // defaut n'aurait pas ete une exception mais une habitude — et ce test
    // aurait vise trop etroit.
    for (const route of ['"/sync/events"', '"/sync/broadcast"']) {
      const debut = SOURCE.indexOf(`router.${route.includes("events") ? "get" : "post"}(${route}`);
      const bloc = SOURCE.slice(debut, debut + 400);
      expect(bloc, `${route} devrait refuser une requete sans session`).toMatch(/401/);
    }
  });
});
