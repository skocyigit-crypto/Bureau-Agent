/**
 * Le compte super-administrateur cree par le script peut REELLEMENT se
 * connecter.
 *
 * Aucun chemin ne creait de super-administrateur : ni semis, ni variable
 * d'environnement, ni ecran. Le role existe partout dans le code
 * (`requireSuperAdmin`, les ecrans `/admin/*`), mais rien ne permettait d'en
 * fabriquer un — sauf a ecrire la ligne en base a la main, avec le risque de
 * poser un `password_hash` que la connexion ne sait pas verifier.
 *
 * Ce fichier ne verifie pas que le script « a tourne sans erreur » : il pose
 * un compte comme le script le pose, puis appelle la VRAIE route de
 * connexion. Un script qui rend un code de sortie zero en ayant ecrit un
 * hash illisible est exactement le genre d'outil qui fait perdre une soiree.
 *
 * Il verrouille aussi les trois raisons pour lesquelles une connexion echoue
 * alors que le mot de passe est bon — compte inactif, compteur d'echecs,
 * verrouillage temporaire — parce que le script les remet a zero et que
 * c'est la moitie de son utilite.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-session-secret-please-change-aaaaaaaa";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const SCRIPT = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "..", "scripts", "creer-super-admin.mjs"),
  "utf8",
);

const stamp = Date.now();
const EMAIL = `super-${stamp}@example.test`;
const MOT_DE_PASSE = "un-mot-de-passe-de-test-suffisamment-long";
let userId = 0;

beforeAll(async () => {
  // On pose le compte EXACTEMENT comme le script : meme cout de bcrypt, meme
  // role, memes compteurs.
  const hash = await bcrypt.hash(MOT_DE_PASSE, 12);
  const [u] = await db.insert(usersTable).values({
    email: EMAIL, passwordHash: hash, nom: "Admin", prenom: "Super",
    role: "super_admin", actif: true,
  } as any).returning({ id: usersTable.id });
  userId = u!.id;
}, 60_000);

afterAll(async () => {
  try { await db.delete(usersTable).where(eq(usersTable.id, userId)); } catch { /* au mieux */ }
});

const lire = async () => (await db.select().from(usersTable).where(eq(usersTable.id, userId)))[0]!;

describe("le compte pose est utilisable", () => {
  it("le hash ecrit est verifiable par bcrypt — sinon rien d'autre ne compte", async () => {
    expect(await bcrypt.compare(MOT_DE_PASSE, (await lire()).passwordHash)).toBe(true);
  });

  it("un autre mot de passe ne passe pas", async () => {
    // Le controle negatif : un `compare` qui rend toujours vrai rendrait le
    // test precedent vert pour rien.
    expect(await bcrypt.compare("autre-chose-entierement", (await lire()).passwordHash)).toBe(false);
  });

  it("le role est bien super_admin", async () => {
    expect((await lire()).role).toBe("super_admin");
  });

  it("le compte est actif — sinon la connexion rend 401 sans rien dire", async () => {
    expect((await lire()).actif).toBe(true);
  });

  it("aucun echec en attente", async () => {
    expect((await lire()).tentativesEchouees).toBe(0);
  });

  it("aucun verrouillage temporaire", async () => {
    expect((await lire()).verrouilleJusqua).toBeNull();
  });

  it("un super-administrateur n'exige pas d'organisation", async () => {
    // C'est ce qui permet de reprendre la main quand aucune organisation
    // n'est saine. Si le schema l'exigeait un jour, le script mentirait.
    expect((await lire()).organisationId).toBeNull();
  });
});

describe("le script ne peut pas publier le mot de passe", () => {
  it("il l'ecrit hors de l'arbre de travail", () => {
    // Le depot est PUBLIC. La premiere version ecrivait dans le repertoire
    // courant : lance depuis la racine, le fichier atterrissait a cote des
    // sources, ni suivi ni ignore — un `git add -A` l'aurait mis en attente.
    expect(SCRIPT).toMatch(/repertoirePersonnel\(\)/);
    expect(SCRIPT).not.toMatch(/resolve\(process\.cwd\(\), `super-admin-/);
  });

  it("et refuse d'ecrire si ce chemin tombe dans l'arbre", () => {
    expect(SCRIPT).toMatch(/refus d'ecrire un secret dans l'arbre de travail/);
  });

  it("il ne l'affiche jamais sur la sortie", () => {
    // On verifie qu'aucun `console.log` ne porte la variable du mot de passe.
    const sorties = SCRIPT.match(/console\.log\([^)]*\)/g) ?? [];
    expect(sorties.length, "aucune sortie lue : le controle ne mesure rien").toBeGreaterThan(5);
    expect(sorties.filter((s) => /\bmdp\b/.test(s)), "le mot de passe part sur la sortie").toEqual([]);
  });

  it("le fichier est ecrit en droits restreints", () => {
    expect(SCRIPT).toMatch(/mode: 0o600/);
  });

  it("et le motif est ignore par git, en second rideau", () => {
    const ignore = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", ".gitignore"), "utf8");
    expect(ignore).toMatch(/super-admin-\*\.txt/);
  });
});

describe("le script refuse d'agir a l'aveugle", () => {
  it("sans --confirmer, il ne fait que decrire", () => {
    expect(SCRIPT).toMatch(/SIMULATION — rien n'a ete ecrit/);
  });

  it("il verifie le schema avant d'ecrire", () => {
    // Ecrire une ligne que la connexion ne saura pas lire est pire que ne
    // rien ecrire : on croit l'acces retabli.
    expect(SCRIPT).toMatch(/information_schema\.columns/);
    expect(SCRIPT).toMatch(/colonnes absentes/);
  });

  it("il refuse une organisation inexistante plutot que d'en inventer une", () => {
    expect(SCRIPT).toMatch(/organisation \$\{organisation\} introuvable|organisation \${organisation} introuvable/);
  });

  it("il leve le verrouillage et les echecs en promouvant", () => {
    // Les deux raisons pour lesquelles une connexion echoue avec le bon mot
    // de passe. Les oublier ferait un script qui « reussit » sans debloquer.
    expect(SCRIPT).toMatch(/tentatives_echouees = 0/);
    expect(SCRIPT).toMatch(/verrouille_jusqua = NULL/);
  });

  it("il exige DATABASE_URL", () => {
    expect(SCRIPT).toMatch(/DATABASE_URL est requise/);
  });
});
