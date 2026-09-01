import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import router from "../routes/data-protection";

/**
 * Qui peut telecharger le fichier entier de l'organisation.
 *
 * /data-protection/export ne rend pas « les donnees du demandeur »: il rend
 * TOUT — contacts, prospects, historique d'appels, notes internes. Il a
 * longtemps ete accessible a tout salarie: le plancher global des mutations
 * (routes/index.ts) n'exige qu'un role `agent`, si bien que seuls les comptes
 * `lecture_seule` etaient arretes, et l'interface affichait le bouton a tout
 * le monde. Une exfiltration complete du CRM tenait en une requete, sous
 * couvert de portabilite RGPD.
 *
 * L'article 20 ouvre pourtant un droit sur SES PROPRES donnees, pas sur
 * celles des clients de l'employeur. Restreindre ne prive donc personne de
 * son droit: la demande individuelle reste ouverte a tous (voir le dernier
 * test), et c'est elle le canal legal.
 *
 * La regression serait invisible — retirer le garde ne casse aucun ecran,
 * l'export continue de fonctionner. Seulement, il fonctionnerait pour tout le
 * monde. D'ou ce test.
 */

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: Function }>;
  };
};

function routeFor(method: string, path: string) {
  const layer = (router.stack as Layer[]).find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  expect(layer, `route introuvable: ${method.toUpperCase()} ${path}`).toBeDefined();
  return layer!.route!;
}

/** Fait passer une session au premier maillon de la route et observe. */
async function callGuard(route: ReturnType<typeof routeFor>, session: unknown) {
  let statusCode = 0;
  let passed = false;
  const req = { session, get: () => undefined, method: "POST" };
  const res = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  };
  await route.stack[0]!.handle(req, res, () => { passed = true; });
  return { statusCode, passed };
}

const EXPORT = "/data-protection/export";

describe("export integral de l'organisation", () => {
  it("est protege par un garde avant son gestionnaire", () => {
    // Un gestionnaire seul (pile de 1) signifie qu'aucun garde n'est installe.
    const route = routeFor("post", EXPORT);
    expect(route.stack.length, "aucun middleware avant le gestionnaire").toBeGreaterThan(1);
  });

  it("refuse un salarie ordinaire", async () => {
    const route = routeFor("post", EXPORT);
    const { statusCode, passed } = await callGuard(route, {
      userId: 7, organisationId: 1, userRole: "agent",
    });

    expect(passed, "un compte agent a franchi le garde").toBe(false);
    expect(statusCode).toBe(403);
  });

  it("refuse un compte en lecture seule", async () => {
    const route = routeFor("post", EXPORT);
    const { statusCode, passed } = await callGuard(route, {
      userId: 8, organisationId: 1, userRole: "lecture_seule",
    });

    expect(passed).toBe(false);
    expect(statusCode).toBe(403);
  });

  it("refuse une session sans role", async () => {
    const route = routeFor("post", EXPORT);
    const { passed, statusCode } = await callGuard(route, { userId: 9, organisationId: 1 });

    expect(passed).toBe(false);
    // Le code compte autant que le refus: sans garde, la requete atteindrait
    // le gestionnaire et echouerait plus loin (500). Un 403 prouve que c'est
    // bien le controle d'acces qui a tranche.
    expect(statusCode).toBe(403);
  });

  it("laisse passer les administrateurs", async () => {
    // Le garde doit rester utilisable: trop etroit, l'export deviendrait
    // inaccessible et la portabilite ne serait plus assuree du tout.
    for (const userRole of ["administrateur", "super_admin"]) {
      const route = routeFor("post", EXPORT);
      const { passed, statusCode } = await callGuard(route, {
        userId: 1, organisationId: 1, userRole,
      });

      expect(passed, `${userRole} bloque a tort (HTTP ${statusCode})`).toBe(true);
    }
  });
});

describe("demande individuelle", () => {
  it("reste ouverte a tous, sinon le droit d'acces disparaitrait", () => {
    // C'est ce qui rend la restriction ci-dessus legitime: le canal de
    // l'article 20 pour une personne physique passe par la, pas par l'export
    // global. Le fermer aussi supprimerait le droit au lieu de le rediriger.
    const route = routeFor("post", "/data-protection/request");
    expect(route.stack.length, "un garde de role a ete ajoute a la demande individuelle").toBe(1);
  });
});
