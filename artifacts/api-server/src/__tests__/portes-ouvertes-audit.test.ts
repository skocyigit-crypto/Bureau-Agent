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

  /**
   * LA GARDE POSEE SUR LA ROUTE, ET SA DEFINITION — RELIEES.
   *
   * Ces deux assertions etaient independantes : l'une verifiait que la route
   * porte UN middleware (`\w+` accepte n'importe quel identifiant), l'autre
   * qu'une chaine `requireRole("super_admin", "administrateur")` existe
   * QUELQUE PART dans le fichier. Rien ne disait que la seconde definissait la
   * premiere.
   *
   * Le sabotage qui les laissait vertes est banal — un artefact de refactor :
   * laisser `const exportReserveAuResponsable = requireRole(...)` en place,
   * desormais inutilise, et ecrire
   * `router.get("/export/:entity", requireAuth, ...)`. Les deux passaient, et
   * un compte `lecture_seule` reexportait contacts, prospects, devis et
   * factures. C'est le test qui ferme cette faille, et il ne la fermait pas.
   *
   * On lit donc le NOM du middleware pose sur la route, puis sa definition.
   */
  const gardePosee = (): string => {
    const m = /router\.get\("\/export\/:entity",\s*([A-Za-z_$][\w$]*)\s*,/.exec(source);
    return m?.[1] ?? "";
  };

  it("la route porte une garde de role", () => {
    const garde = gardePosee();
    expect(
      garde,
      "le seul filtre etait « etre authentifie »: le CRM complet en une requete",
    ).not.toBe("");
    expect(garde, "aucun middleware avant le gestionnaire").not.toBe("async");
  });

  it("et c'est CETTE garde qui s'arrete au responsable", () => {
    const garde = gardePosee();
    const def = new RegExp(`${garde}\\s*=\\s*requireRole\\(([^)]*)\\)`).exec(source);
    expect(def, `${garde} n'est pas defini par un requireRole dans ce fichier`).not.toBeNull();
    const roles = def![1]!;
    expect(roles).toMatch(/"super_admin"/);
    expect(roles).toMatch(/"administrateur"/);
    expect(roles, "un agent ou un lecture_seule exporterait encore").not.toMatch(/"agent"|"lecture_seule"/);
  });

  it("le plancher global ne suffisait pas, et le test doit s'en souvenir", () => {
    const index = lire("routes", "index.ts");
    // `indexOf` rend -1 quand la chaine est absente, et `slice(-1)` rend alors
    // le DERNIER caractere du fichier — non vide, donc `toBeTruthy()` passait
    // quel que soit l'etat du produit. L'assertion ne pouvait pas echouer :
    // supprimer le plancher entier la laissait verte.
    expect(
      index,
      "le plancher global a disparu de routes/index.ts",
    ).toMatch(/router\.use\(requireMutationRole\(/);
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
