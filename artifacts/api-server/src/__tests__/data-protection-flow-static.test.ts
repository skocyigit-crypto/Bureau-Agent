import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import router, { requestDeadline } from "../routes/data-protection";

/**
 * La chaine RGPD, verrouillee la ou elle peut casser sans bruit.
 *
 * Trois defauts distincts sont figes ici, et aucun des trois ne se voit a
 * l'ecran — c'est ce qui les rend durables.
 *
 * 1. L'export individuel traverse des tables qui contiennent des secrets:
 *    empreinte de mot de passe, secret MFA, jetons de reinitialisation,
 *    jetons OAuth Google, jeton de notification d'un appareil. Un export RGPD
 *    est exactement ce qu'on remet a l'exterieur — un `select()` complet
 *    ajoute au fil du temps les livrerait tous, sans qu'aucun test
 *    fonctionnel ne s'en apercoive: la route continuerait de repondre 200
 *    avec un peu plus de champs.
 *
 * 2. La cloture d'une demande est la SEULE ecriture de tout le depot sur
 *    `data_subject_requests`. Si son garde de role saute, n'importe quel
 *    salarie peut declarer traitee la demande d'un autre — et la trace ainsi
 *    produite est precisement ce qu'on presenterait a la CNIL.
 *
 * 3. L'echeance d'un mois est du calcul de date. Elle se trompe en silence,
 *    et une erreur d'un jour sur un delai legal n'a pas de symptome visible.
 */

const ROUTE_FILE = path.resolve(import.meta.dirname, "../routes/data-protection.ts");

type Layer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: unknown, res: unknown, next: () => void) => unknown }>;
  };
};

function routeFor(method: string, routePath: string) {
  const layer = (router.stack as Layer[]).find(
    (l) => l.route?.path === routePath && l.route.methods[method],
  );
  expect(layer, `route introuvable: ${method.toUpperCase()} ${routePath}`).toBeDefined();
  return layer!.route!;
}

/**
 * Fait passer une session au premier maillon de la route et observe.
 *
 * Le garde est eprouve par son COMPORTEMENT et non par le nom de sa fonction:
 * renommer `requireRole` ou l'envelopper ne doit pas faire passer le test au
 * vert alors que la protection a disparu.
 */
async function callGuard(route: ReturnType<typeof routeFor>, session: unknown) {
  let statusCode = 0;
  let passed = false;
  const req = { session, params: { id: "1" }, body: {}, get: () => undefined, method: "POST" };
  const res = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  };
  await route.stack[0]!.handle(req, res, () => { passed = true; });
  return { statusCode, passed };
}

describe("export individuel — art. 15 et 20", () => {
  it("existe, et est ouvert a toute personne authentifiee", () => {
    // Le droit d'acces appartient a la personne, pas au grade. Le reserver
    // aux administrateurs le rendrait inexercable par ceux-la memes qu'il
    // protege — c'est le trou que cette route comble.
    const route = routeFor("get", "/data-protection/my-data");
    expect(
      route.stack.length,
      "un garde de role filtre l'acces a ses propres donnees",
    ).toBe(1);
  });

  it("n'expose aucune colonne secrete", () => {
    const src = fs.readFileSync(ROUTE_FILE, "utf8");
    const handler = src.slice(
      src.indexOf('router.get("/data-protection/my-data"'),
      src.indexOf('router.post("/data-protection/requests/:id/process"'),
    );
    expect(handler.length, "corps de la route introuvable").toBeGreaterThan(500);

    // Ces noms ne doivent apparaitre NULLE PART dans le corps de la route:
    // ni selectionnes, ni filtres dessus.
    const secrets = [
      "passwordHash", "mfaSecret", "resetPasswordToken", "emailVerificationToken",
      "accessToken", "refreshToken", "clientSecretEnc", "lastLoginFingerprint",
      "tokenInvalidatedAt",
    ];
    for (const secret of secrets) {
      expect(handler.includes(secret), `l'export ne doit pas contenir ${secret}`).toBe(false);
    }

    // `pushTokensTable.token` est le jeton d'ecriture vers l'appareil. Il est
    // exclu par selection explicite; ce test verifie qu'on ne l'a pas rajoute.
    expect(handler).toContain("platform: pushTokensTable.platform");
    expect(handler.includes("token: pushTokensTable.token")).toBe(false);
  });

  it("ne rend pas le fichier de l'organisation sous couvert de droit individuel", () => {
    const src = fs.readFileSync(ROUTE_FILE, "utf8");
    const handler = src.slice(
      src.indexOf('router.get("/data-protection/my-data"'),
      src.indexOf('router.post("/data-protection/requests/:id/process"'),
    );
    // Contacts, appels, taches et prospects portent un `createdBy`: on peut
    // les rattacher a un salarie, mais ils appartiennent au responsable de
    // traitement. Les servir ici rouvrirait l'exfiltration integrale du CRM
    // que /data-protection/export a ete restreint pour fermer — cette fois
    // sans aucun garde de role, puisque cette route n'en a pas.
    for (const table of ["contactsTable", "callsTable", "tasksTable", "prospectsTable", "notesInternesTable"]) {
      expect(handler.includes(table), `${table} n'a rien a faire dans l'export individuel`).toBe(false);
    }
  });
});

describe("cloture d'une demande", () => {
  it("refuse un salarie ordinaire et un compte en lecture seule", async () => {
    const route = routeFor("post", "/data-protection/requests/:id/process");
    expect(route.stack.length, "aucun middleware avant le gestionnaire").toBeGreaterThan(1);

    for (const userRole of ["agent", "lecture_seule"]) {
      const { statusCode, passed } = await callGuard(route, {
        userId: 7, organisationId: 1, userRole,
      });
      // Le code compte autant que le refus: sans garde, la requete
      // atteindrait le gestionnaire et echouerait plus loin. Un 403 prouve
      // que c'est bien le controle d'acces qui a tranche.
      expect(passed, `${userRole} a franchi le garde`).toBe(false);
      expect(statusCode).toBe(403);
    }
  });

  it("laisse passer les administrateurs", async () => {
    // Trop etroit, le garde rendrait toute demande inclosable — et le produit
    // repromettrait une reponse sous 30 jours sans pouvoir la donner.
    for (const userRole of ["administrateur", "super_admin"]) {
      const route = routeFor("post", "/data-protection/requests/:id/process");
      const { passed, statusCode } = await callGuard(route, {
        userId: 1, organisationId: 1, userRole,
      });
      expect(passed, `${userRole} bloque a tort (HTTP ${statusCode})`).toBe(true);
    }
  });

  it("borne la mise a jour a l'organisation et aux demandes encore ouvertes", () => {
    const src = fs.readFileSync(ROUTE_FILE, "utf8");
    const handler = src.slice(src.indexOf('router.post("/data-protection/requests/:id/process"'));

    // Sans le filtre de tenant, un identifiant devine suffirait a clore la
    // demande d'une autre organisation.
    expect(handler).toContain("eq(dataSubjectRequestsTable.organisationId, orgId)");
    // Sans le filtre sur `pending`, une demande deja traitee pourrait etre
    // reecrite — et avec elle la preuve de qui a repondu quoi, et quand.
    expect(handler).toContain('eq(dataSubjectRequestsTable.status, "pending")');
  });

  it("exige un motif pour refuser", () => {
    const src = fs.readFileSync(ROUTE_FILE, "utf8");
    // Art. 12(4): un refus doit exposer ses motifs et rappeler la voie de
    // reclamation. Un refus muet serait indistinguable d'un oubli.
    expect(src).toMatch(/status === "refused" && notes\.length === 0/);
    expect(src).toContain("12(4)");
  });
});

describe("echeance de l'article 12(3)", () => {
  it("place l'echeance un mois apres le depot", () => {
    const { dueAt, overdue } = requestDeadline(
      new Date("2026-01-15T10:00:00Z"),
      new Date("2026-01-20T10:00:00Z"),
    );
    expect(dueAt.toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(overdue).toBe(false);
  });

  it("compte en mois de calendrier, pas en tranches de 30 jours", () => {
    // Une demande deposee le 31 janvier n'a pas d'echeance au 31 fevrier.
    // JavaScript reporte alors sur mars, ce qui allonge le delai — donc joue
    // en faveur de la personne, jamais contre elle. C'est le comportement
    // voulu; ce test le fige pour qu'un passage a « +30 jours » ne le
    // raccourcisse pas en silence.
    const { dueAt } = requestDeadline(
      new Date("2026-01-31T10:00:00Z"),
      new Date("2026-02-01T10:00:00Z"),
    );
    expect(dueAt.getUTCMonth()).toBe(2); // mars
  });

  it("declare en retard une demande depassee, et seulement elle", () => {
    const depot = new Date("2026-01-15T10:00:00Z");
    // La veille de l'echeance: encore dans les temps.
    expect(requestDeadline(depot, new Date("2026-02-14T10:00:00Z")).overdue).toBe(false);
    // Le lendemain: le manquement est constitue.
    expect(requestDeadline(depot, new Date("2026-02-17T10:00:00Z")).overdue).toBe(true);
  });
});
