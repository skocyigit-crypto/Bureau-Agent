/**
 * Deux invariants que le depot fait respecter d'un cote et pas de l'autre.
 *
 * 1. L'EXPORT EST RESERVE AU RESPONSABLE.
 *    `GET /api/export/:entity` porte cette garde depuis l'audit du 19/09, avec
 *    un commentaire qui nomme le trou : « un compte lecture_seule obtenait le
 *    fichier client complet en une requete ». Huit exports CSV par module
 *    rendaient exactement la meme matiere — contacts, prospects, appels,
 *    taches, messages, agenda, automatisations, depenses — sans aucune garde
 *    de role. Le plancher global de `routes/index.ts` n'y peut rien : il
 *    exempte les GET par construction.
 *
 * 2. ON N'AGIT PAS SUR UN PAIR.
 *    `assertCallerOutranks` refuse « un role superieur ou egal au votre », et
 *    PATCH comme DELETE sur `/auth/users/:id` l'appellent. Les routes de masse
 *    `bulk/deactivate` et `bulk/delete` se contentaient d'exclure
 *    `super_admin` : le rang EGAL passait. Un administrateur evincait ses
 *    pairs — jusqu'a supprimer definitivement leurs comptes — en une requete.
 *    La voie de masse contournait l'invariant que la voie unitaire fait
 *    respecter.
 *
 * Le premier bloc est un BALAYAGE : corriger huit routes nommees laisse la
 * neuvieme, ecrite demain. Le second est BEHAVIORAL : c'est le refus du
 * serveur qu'il mesure, et l'etat de la base apres coup.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, organisationsTable, usersTable } from "@workspace/db";
import authRouter from "../routes/auth";
import contactsRouter from "../routes/contacts";

const ROUTES = join(import.meta.dirname, "..", "routes");

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".ts") && !p.includes(".test.") ? [p] : [];
  });
}

/**
 * Les routes d'export, et la facon dont chacune est gardee.
 *
 * Un export se reconnait a son chemin (`/export`) : c'est ainsi que les huit
 * se nommaient, et c'est ce qu'ecrira la neuvieme.
 *
 * La garde prend TROIS formes legitimes dans ce depot, et un controle qui n'en
 * reconnaitrait qu'une crierait au loup sur du code correct :
 *   - un middleware sur la ligne de la route (`router.get(chemin, garde, …)`);
 *   - un `router.use("/prefixe", garde)` en tete de fichier, qui couvre tout
 *     le routeur (c'est le cas de la sauvegarde Google Drive);
 *   - une verification de role DANS le corps du gestionnaire (`audit.ts`,
 *     `auth.ts`, `license-management.ts`).
 *
 * L'invariant mesure donc l'effet, pas la forme : est-ce qu'un compte en
 * lecture seule peut obtenir ce fichier ?
 */
function routesDExport(): Array<{ ou: string; chemin: string; gardee: boolean }> {
  const out: Array<{ ou: string; chemin: string; gardee: boolean }> = [];
  for (const f of fichiers(ROUTES)) {
    const source = readFileSync(f, "utf8");
    const nomFichier = f.split(/[\\/]/).slice(-1)[0]!;

    for (const m of source.matchAll(/router\.get\(\s*"([^"]*\/export[^"]*)"\s*,\s*([A-Za-z_$][\w$]*)?/g)) {
      const chemin = m[1]!;
      const suivant = m[2];

      // 1. Middleware sur la ligne. `async` signifie qu'il n'y en a pas.
      const middleware = suivant && suivant !== "async" ? suivant : null;

      // 2. Garde de routeur couvrant ce chemin.
      const prefixeGarde = [...source.matchAll(/router\.use\(\s*"([^"]+)"\s*,\s*([A-Za-z_$][\w$]*)/g)]
        .some(([, prefixe, garde]) => chemin.startsWith(prefixe!) && /require|assert/i.test(garde!));

      // 3. Verification de role dans le corps, avant tout travail.
      const debut = source.indexOf(`"${chemin}"`);
      const corps = source.slice(debut, debut + 900);
      const dansLeCorps = /requireAdmin\(|userRole !== "super_admin"|userRole !== "administrateur"/.test(corps);

      const gardee = Boolean(middleware) || prefixeGarde || dansLeCorps;
      out.push({ ou: nomFichier, chemin, gardee });
    }
  }
  return out;
}

describe("aucun export ne s'ouvre a la lecture seule", () => {
  it("le balayage trouve bien des exports a controler", () => {
    // Sans ce garde-fou, une detection cassee ferait passer l'assertion
    // suivante sans rien garantir.
    expect(routesDExport().length, "plus aucun export detecte: la detection est cassee").toBeGreaterThan(8);
  });

  it("chacun est garde, sous l'une des trois formes", () => {
    const nus = routesDExport().filter((r) => !r.gardee).map((r) => `${r.ou} ${r.chemin}`);
    expect(nus, `export sans garde de role: ${nus.join(", ")}`).toEqual([]);
  });

  it("et aucune garde nommee n'admet la lecture seule", () => {
    // Un middleware quelconque ne prouve rien: c'est la RESTRICTION qui
    // compte. On relit donc la definition de chaque garde nommee.
    //
    // `documents.ts` s'arrete a l'agent (`requireMinAgent`) et c'est un
    // arbitrage assume: un agent travaille sur les documents. Le plancher
    // commun est plus bas — personne en lecture seule n'exporte.
    const faibles: string[] = [];
    for (const f of fichiers(ROUTES)) {
      const source = readFileSync(f, "utf8");
      const nomFichier = f.split(/[\\/]/).slice(-1)[0]!;
      for (const m of source.matchAll(/router\.get\(\s*"([^"]*\/export[^"]*)"\s*,\s*([A-Za-z_$][\w$]*)\s*,/g)) {
        const garde = m[2]!;
        if (garde === "async") continue;
        const def = new RegExp(`${garde}\\s*=\\s*requireRole\\(([^)]*)\\)`).exec(source);
        if (!def) continue; // garde definie ailleurs: couverte par le bloc precedent
        if (/lecture_seule/.test(def[1]!)) faibles.push(`${nomFichier} ${m[1]} (${garde} accepte ${def[1]})`);
      }
    }
    expect(faibles, `garde trop large: ${faibles.join(", ")}`).toEqual([]);
  });
});

// ── Partie behaviorale ───────────────────────────────────────────────────────

const stamp = Date.now();
let orgId = 0;
let admin = 0, pair = 0, agent = 0, lecteur = 0;

function appli(routeur: express.Router, role: string, userId: number) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = { userId, organisationId: orgId, userRole: role };
    (req as any).log = { info() {}, warn() {}, error() {} };
    next();
  });
  a.use("/api", routeur);
  return a;
}

async function utilisateur(role: string, marqueur: string) {
  const [u] = await db.insert(usersTable).values({
    organisationId: orgId, email: `${marqueur}-${stamp}@example.test`, passwordHash: "x",
    prenom: marqueur, nom: "T", role, actif: true,
  }).returning({ id: usersTable.id });
  return u!.id;
}

const lire = async (id: number) =>
  (await db.select().from(usersTable).where(eq(usersTable.id, id)))[0];

beforeAll(async () => {
  const [o] = await db.insert(organisationsTable).values({
    name: `Rang ${stamp}`, slug: `rang-${stamp}`, maxUsers: 500, actif: true,
  }).returning({ id: organisationsTable.id });
  orgId = o!.id;
  admin = await utilisateur("administrateur", "admin");
}, 60_000);

afterAll(async () => {
  try {
    await db.delete(usersTable).where(eq(usersTable.organisationId, orgId));
    await db.delete(organisationsTable).where(eq(organisationsTable.id, orgId));
  } catch { /* journaux en ajout seul */ }
});

beforeEach(async () => {
  // Des cibles fraiches a chaque controle: un test qui supprime ne doit pas
  // vider le terrain du suivant.
  pair = await utilisateur("administrateur", `pair${Math.random().toString(36).slice(2, 8)}`);
  agent = await utilisateur("agent", `agent${Math.random().toString(36).slice(2, 8)}`);
  lecteur = await utilisateur("lecture_seule", `lect${Math.random().toString(36).slice(2, 8)}`);
});

describe("un administrateur n'evince pas ses pairs en masse", () => {
  const app = () => appli(authRouter as express.Router, "administrateur", admin);

  it("la desactivation groupee epargne un autre administrateur", async () => {
    await request(app()).post("/api/auth/users/bulk/deactivate").send({ ids: [pair] });
    expect((await lire(pair))!.actif, "un pair a ete desactive").toBe(true);
  });

  it("la suppression groupee epargne un autre administrateur", async () => {
    await request(app()).post("/api/auth/users/bulk/delete").send({ ids: [pair] });
    expect(await lire(pair), "un pair a ete supprime").toBeTruthy();
  });

  it("mais elle atteint bien un agent", async () => {
    // Le garde-fou ne doit pas rendre la fonction inutilisable.
    await request(app()).post("/api/auth/users/bulk/deactivate").send({ ids: [agent] });
    expect((await lire(agent))!.actif).toBe(false);
  });

  it("et un compte en lecture seule", async () => {
    await request(app()).post("/api/auth/users/bulk/delete").send({ ids: [lecteur] });
    expect(await lire(lecteur)).toBeUndefined();
  });

  it("dans un lot mixte, seuls les rangs inferieurs tombent", async () => {
    // C'est le cas reel: on coche tout, et le pair passait avec le reste.
    await request(app()).post("/api/auth/users/bulk/deactivate").send({ ids: [pair, agent, lecteur] });
    expect((await lire(pair))!.actif, "le pair est tombe avec le lot").toBe(true);
    expect((await lire(agent))!.actif).toBe(false);
    expect((await lire(lecteur))!.actif).toBe(false);
  });

  it("un super_admin reste hors d'atteinte", async () => {
    const proprietaire = await utilisateur("super_admin", `sa${Math.random().toString(36).slice(2, 8)}`);
    await request(app()).post("/api/auth/users/bulk/delete").send({ ids: [proprietaire] });
    expect(await lire(proprietaire)).toBeTruthy();
  });

  it("un super_admin, lui, atteint un administrateur", async () => {
    // Le role est relu EN BASE par `requireTenant`, pas cru sur parole depuis
    // la session — c'est la bonne regle, et elle oblige ce controle a se doter
    // d'un vrai compte proprietaire plutot que d'une session decoree.
    const proprietaire = await utilisateur("super_admin", `chef${Math.random().toString(36).slice(2, 8)}`);
    const r = await request(appli(authRouter as express.Router, "super_admin", proprietaire))
      .post("/api/auth/users/bulk/deactivate").send({ ids: [pair] });
    expect(r.status).toBe(200);
    expect((await lire(pair))!.actif, "le proprietaire ne peut plus rien").toBe(false);
  });
});

describe("l'export CSV refuse la lecture seule", () => {
  it("un compte lecture_seule est refuse", async () => {
    const r = await request(appli(contactsRouter as express.Router, "lecture_seule", lecteur))
      .get("/api/contacts/export/csv");
    expect(r.status, "le fichier client est parti").toBe(403);
  });

  it("un agent aussi", async () => {
    const r = await request(appli(contactsRouter as express.Router, "agent", agent))
      .get("/api/contacts/export/csv");
    expect(r.status).toBe(403);
  });

  it("un administrateur l'obtient", async () => {
    // Sans cela, le controle precedent serait satisfait par une route cassee.
    const r = await request(appli(contactsRouter as express.Router, "administrateur", admin))
      .get("/api/contacts/export/csv");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/csv/);
  });
});
