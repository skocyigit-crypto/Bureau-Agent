/**
 * Trois portes ouvertes, trouvees par l'audit fichier par fichier du 19/09.
 *
 * Elles ont un trait commun : chacune avait sa garde ECRITE quelque part —
 * sur la route voisine, sur l'autre chemin du meme routeur, dans le meme
 * fichier a deux routes de distance. Ce ne sont pas des protections qu'on a
 * jugees inutiles, ce sont des protections qu'on a oublie de reporter.
 *
 * 1. `GET /api/export/:entity` — le CRM complet en une requete.
 *    Seul filtre : etre authentifie. Le plancher global `requireMutationRole`
 *    ne protege rien ici, puisqu'il laisse passer GET par construction. Un
 *    compte `lecture_seule` obtenait contacts, prospects, devis et factures
 *    en CSV. C'est le trou que
 *    `data-protection-export-access.test.ts` a ferme pour l'export RGPD ; la
 *    porte d'a cote etait restee ouverte.
 *
 * 2. `POST /auth/users/:id/send-credentials` — elevation laterale et
 *    verticale. La route ECRASE `passwordHash`, sans appeler
 *    `assertTargetNotSuperAdmin` ni `assertCallerOutranks`, que PATCH et
 *    DELETE sur le meme identifiant appellent tous les deux. Un
 *    `administrateur` compromis remplacait le mot de passe d'un pair, ou d'un
 *    `super_admin` rattache a l'organisation, par un code qu'il declenchait
 *    lui-meme. Elle ne revoquait par ailleurs ni les jetons Bearer (30 jours)
 *    ni les sessions cookie : l'administrateur croyait reprendre la main, le
 *    voleur restait connecte.
 *
 * 3. `GET /api/admin/saas-attention` — fuite entre CLIENTS. La garde
 *    `requireSuperAdmin` etait posee sur `/admin/saas-dashboard`, mais le
 *    routeur declare deux chemins. Le second lit `organisations` et
 *    `subscriptions` sans filtre : tout compte authentifie voyait la liste de
 *    tous les clients de la plateforme, leur plan, leur prix et leurs impayes.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");
const lire = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");

describe("l'export du CRM est reserve au responsable", () => {
  const source = lire("routes", "export.ts");

  it("la route porte une garde de role", () => {
    expect(
      source,
      "le seul filtre etait « etre authentifie »: le CRM complet en une requete",
    ).toMatch(/router\.get\("\/export\/:entity",\s*\w+,/);
  });

  it("la garde s'arrete au responsable", () => {
    expect(source).toMatch(/requireRole\("super_admin",\s*"administrateur"\)/);
    expect(source, "un agent ou un lecture_seule exporterait encore").not.toMatch(/requireRole\([^)]*"agent"/);
  });

  it("le plancher global ne suffisait pas, et le test doit s'en souvenir", () => {
    const index = lire("routes", "index.ts");
    const plancher = index.slice(index.indexOf("requireMutationRole("));
    expect(plancher.slice(0, 200), "si le plancher couvrait les GET, cette garde serait redondante").toBeTruthy();
    const middleware = lire("middleware", "auth.ts");
    expect(
      middleware,
      "le plancher exempte les lectures: c'est pourquoi chaque export doit se garder lui-meme",
    ).toMatch(/\["GET", "HEAD", "OPTIONS"\]\.includes\(req\.method\)/);
  });
});

describe("la reinitialisation administrative d'un mot de passe", () => {
  const auth = lire("routes", "auth.ts");
  const bloc = auth.slice(auth.indexOf('"/auth/users/:id/send-credentials"'));
  const corps = bloc.slice(0, 3000);

  it("refuse de viser un super-admin", () => {
    expect(
      corps,
      "un administrateur remplacait le mot de passe d'un super_admin",
    ).toMatch(/assertTargetNotSuperAdmin\(req, res, user\)/);
  });

  it("exige que l'appelant surclasse sa cible", () => {
    expect(
      corps,
      "un administrateur remplacait le mot de passe d'un PAIR",
    ).toMatch(/assertCallerOutranks\(req, res, user\.role\)/);
  });

  it("revoque les jetons Bearer existants", () => {
    expect(
      corps,
      "le jeton vole (30 jours) survivait au reset: la reprise en main etait une illusion",
    ).toMatch(/tokenInvalidatedAt: new Date\(\)/);
  });

  it("revoque aussi les sessions cookie", () => {
    expect(corps).toMatch(/invalidateUserSessions\(id\)/);
    expect(corps).toMatch(/clearTokenInvalidationCache\(id\)/);
  });

  it("les memes gardes existaient deja sur les routes voisines", () => {
    // Ce controle dit pourquoi l'oubli etait un oubli, et non un choix.
    const patch = auth.slice(auth.indexOf('router.patch("/auth/users/:id"'), auth.indexOf('"/auth/users/:id/send-credentials"'));
    expect(patch).toMatch(/assertTargetNotSuperAdmin/);
    expect(patch).toMatch(/assertCallerOutranks/);
  });
});

describe("le tableau de bord de la plateforme ne fuit pas entre clients", () => {
  const index = lire("routes", "index.ts");
  const dashboard = lire("routes", "admin-saas-dashboard.ts");

  it("chaque chemin declare par le routeur porte la garde super-admin", () => {
    const chemins = [...dashboard.matchAll(/router\.(?:get|post)\("(\/admin\/[^"]+)"/g)].map((m) => m[1]);
    expect(chemins.length, "aucun chemin lu: le controle ne prouve rien").toBeGreaterThan(1);
    for (const chemin of chemins) {
      expect(
        index,
        `« ${chemin} » n'est pas garde: une garde par chemin doit couvrir CHAQUE chemin du routeur`,
      ).toContain(`router.use("${chemin}", requireSuperAdmin)`);
    }
  });

  it("la source de ces donnees ne filtre pas par organisation, d'ou la gravite", () => {
    const service = lire("services", "saas-attention.ts");
    const collecte = service.slice(service.indexOf("gatherSaasAttention"));
    expect(
      collecte.slice(0, 2000),
      "si ce service filtrait par organisation, la garde manquante serait moins grave",
    ).not.toMatch(/eq\(organisationsTable\.id,/);
  });
});
