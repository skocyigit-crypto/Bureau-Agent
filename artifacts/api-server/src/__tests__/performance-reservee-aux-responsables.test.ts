/**
 * Les heures et les pauses des collegues ne sont pas ouvertes a tout le monde.
 *
 * CE QUE CES ROUTES RENDENT
 *
 * `/performance/metriques` agrege, pour CHAQUE salarie de l'organisation:
 * actions, connexions, taches, appels, pointages, HEURES TRAVAILLEES et
 * MINUTES DE PAUSE. La duree des pauses en fait une mesure du temps de
 * travail, pas une statistique d'usage. `/performance/metriques/export/csv`
 * rend le tout en un fichier.
 *
 * LE DEFAUT: UNE REGLE APPLIQUEE D'UN SEUL COTE
 *
 * L'interface reservait deja ces ecrans aux responsables — `App.tsx`:
 *
 *     <Route path="/performance"
 *            component={withRoleGate(PerformancePage, ADMIN_ROLES)} />
 *
 * Le serveur, lui, ne verifiait que l'authentification. N'importe quel
 * compte — y compris `lecture_seule` — pouvait appeler ces routes
 * directement et obtenir les heures et les pauses de tous ses collegues,
 * export CSV compris. Le garde-fou existait; il manquait la ou il compte.
 *
 * C'est la forme de defaut la plus frequente de ce depot, et la plus
 * silencieuse: rien ne casse, l'ecran est bien protege, et la porte est
 * ouverte a cote.
 *
 * Le cloisonnement par organisation, lui, etait deja correct: ces tests le
 * verrouillent aussi, pour qu'il ne parte pas avec le reste.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "0";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";
process.env.DISABLE_CSRF_DEV = "1";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import app from "../app";
import { mintApiToken } from "../lib/api-token";

const marque = Date.now();
const orgsCreees: number[] = [];

const ROUTES_LECTURE = [
  "/api/performance/metriques",
  "/api/performance/historique",
  "/api/performance/metriques/export/csv",
];

interface Compte {
  id: number;
  token: string;
}

async function creerCompte(tag: string, role: string, organisationId: number): Promise<Compte> {
  const email = `perf-${tag}-${marque}@example.test`;
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: "x",
      nom: "Test",
      prenom: "User",
      role,
      organisationId,
      actif: true,
    })
    .returning({ id: usersTable.id });
  return {
    id: row.id,
    token: mintApiToken({
      userId: row.id,
      userRole: role,
      organisationId,
      userEmail: email,
      prenom: "Test",
      nom: "User",
    }),
  };
}

function appel(methode: "get" | "post", chemin: string, token: string) {
  return request(app)[methode](chemin)
    .set("Authorization", `Bearer ${token}`)
    .set("Origin", "http://localhost");
}

let orgId: number;
let admin: Compte;
let agent: Compte;
let lecteur: Compte;

beforeAll(async () => {
  const [org] = await db
    .insert(organisationsTable)
    .values({
      name: `Perf ${marque}`,
      slug: `perf-${marque}`,
      maxUsers: 5,
      actif: true,
    })
    .returning({ id: organisationsTable.id });
  orgId = org.id;
  orgsCreees.push(org.id);

  admin = await creerCompte("admin", "administrateur", orgId);
  agent = await creerCompte("agent", "agent", orgId);
  lecteur = await creerCompte("lecteur", "lecture_seule", orgId);
});

afterAll(async () => {
  for (const id of orgsCreees) {
    try {
      await db.delete(organisationsTable).where(eq(organisationsTable.id, id));
    } catch {
      // Le nettoyage ne doit jamais faire echouer la suite.
    }
  }
});

describe("un agent ne voit pas les metriques de ses collegues", () => {
  it.each(ROUTES_LECTURE)("refuse %s a un agent", async (chemin) => {
    const res = await appel("get", chemin, agent.token);
    expect(res.status, `${chemin} accessible a un agent`).toBe(403);
  });

  it.each(ROUTES_LECTURE)("refuse %s a un compte en lecture seule", async (chemin) => {
    // `lecture_seule` est le role le plus bas: s'il passe, tout le monde
    // passe.
    const res = await appel("get", chemin, lecteur.token);
    expect(res.status, `${chemin} accessible en lecture seule`).toBe(403);
  });

  it("refuse la generation d'un rapport a un agent", async () => {
    const res = await appel("post", "/api/performance/rapport", agent.token).send({
      periode: "semaine",
    });
    expect(res.status).toBe(403);
  });

  it("l'export CSV est ferme lui aussi", async () => {
    // Le plus facile a oublier: il ne passe pas par l'ecran protege, il se
    // declenche par un lien de telechargement.
    const res = await appel("get", "/api/performance/metriques/export/csv", agent.token);
    expect(res.status).toBe(403);
  });
});

describe("un responsable conserve l'acces", () => {
  it("les metriques restent lisibles par un administrateur", async () => {
    // L'erreur symetrique compte autant: une porte fermee sur les usages
    // legitimes est une panne, pas une securite.
    const res = await appel("get", "/api/performance/metriques", admin.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.metriques)).toBe(true);
  });

  it("l'historique reste lisible par un administrateur", async () => {
    const res = await appel("get", "/api/performance/historique", admin.token);
    expect(res.status).toBe(200);
  });
});

describe("l'interface et le serveur appliquent la MEME regle", () => {
  it("le serveur reserve les quatre routes aux responsables", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "performance.ts"),
      "utf8",
    );
    const routes = source.match(/router\.(get|post)\("\/performance[^"]*",\s*([A-Za-z]+)/g) ?? [];
    expect(routes.length, "des routes de performance ont disparu").toBe(4);
    for (const r of routes) {
      expect(r, `route sans garde: ${r}`).toContain("reserveAuxResponsables");
    }
  });

  it("la garde nomme les memes roles que l'interface", () => {
    // `ADMIN_ROLES` cote SPA vaut ["super_admin", "administrateur"].
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "performance.ts"),
      "utf8",
    );
    expect(source).toContain('requireRole("super_admin", "administrateur")');
  });

  it("l'ecran reste protege cote interface", () => {
    // Si quelqu'un retirait le garde du SPA en pensant que le serveur suffit,
    // l'ecran apparaitrait dans le menu de tout le monde pour finir en 403.
    const app = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "buro-ajani", "src", "App.tsx"),
      "utf8",
    );
    expect(app).toContain("withRoleGate(PerformancePage, ADMIN_ROLES)");
  });
});

describe("la generation d'un rapport laisse une trace", () => {
  it("l'action est journalisee, comme celle de l'agent d'equipe", () => {
    // Meme raison que le #154: une evaluation nominative doit pouvoir etre
    // expliquee — qui l'a demandee, quand, sur qui.
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "performance.ts"),
      "utf8",
    );
    expect(source).toContain("performance_report_generated");
    expect(source).toContain("logAudit(");
  });

  it("une trace impossible a ecrire ne prive pas du rapport", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "performance.ts"),
      "utf8",
    );
    const i = source.indexOf("performance_report_generated");
    expect(source.slice(i, i + 600)).toContain(".catch(");
  });
});

describe("le registre RGPD compte les DEUX sources", () => {
  it("les rapports de performance y sont comptes", () => {
    // Le #154 ne comptait que `ai_agent_reports`. Un second traitement, avec
    // sa propre table, restait invisible dans l'inventaire — donc absent de
    // ce qui peut etre porte a la connaissance des salaries.
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "data-protection.ts"),
      "utf8",
    );
    expect(source).toContain("performanceReportsTable");
    expect(source).toContain("rapportsPerf[0]?.count");
  });

  it("la description nomme les heures et les pauses", () => {
    // Ce sont les donnees les plus sensibles des deux traitements, et celles
    // qu'un salarie a le plus de raisons de vouloir connaitre.
    const source = readFileSync(
      join(import.meta.dirname, "..", "routes", "data-protection.ts"),
      "utf8",
    );
    const i = source.indexOf("Évaluations automatisées de salariés");
    const ligne = source.slice(i, i + 700);
    expect(ligne).toMatch(/heures travaillées/i);
    expect(ligne).toMatch(/pause/i);
  });
});
