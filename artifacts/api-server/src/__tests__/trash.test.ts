import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgres://user:pass@127.0.0.1:5432/testdb";
});

import { RESTORABLE_TABLES } from "../services/tenant-restore";
import { TRASH_RETENTION_DAYS, isRestorableTable } from "../services/trash";
import trashRouter from "../routes/trash";

/**
 * La corbeille — et surtout ce qu'elle ne doit PAS pouvoir remettre.
 *
 * Une fonction qui reinsere des lignes en base a partir d'un contenu stocke
 * est, par nature, le genre d'outil qui devient une faille si son perimetre
 * derive. `tenant-restore` avait deja tranche la question et ecrit la liste:
 * ni `users`, ni `api_keys`, ni les abonnements — remettre un compte ou un
 * abonnement supprime serait un contournement, pas un service. La corbeille
 * reutilise cette liste, et ces tests interdisent qu'elle s'en ecarte.
 *
 * Le reste verrouille le contraire: que la protection soit reellement
 * atteignable. Une corbeille reservee aux administrateurs raterait sa cible,
 * puisque celui qui supprime par erreur est le plus souvent un utilisateur
 * ordinaire — c'est exactement le defaut de la restauration de sauvegarde
 * existante, et la raison d'etre de celle-ci.
 */

const SRC = join(import.meta.dirname, "..");
const SERVICE = readFileSync(join(SRC, "services", "trash.ts"), "utf8");

type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: unknown[] } };

function routeFor(method: string, path: string) {
  const layer = (trashRouter.stack as Layer[]).find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  expect(layer, `route introuvable: ${method.toUpperCase()} ${path}`).toBeDefined();
  return layer!.route!;
}

describe("perimetre de restauration", () => {
  it("refuse les tables que tenant-restore exclut deja", () => {
    // Ces trois-la sont le coeur du sujet: un compte, une cle d'API et un
    // abonnement supprimes ne doivent pas pouvoir revenir par une corbeille.
    for (const table of ["users", "api_keys", "subscriptions", "audit_logs", "ai_usage"]) {
      expect(isRestorableTable(table), `${table} ne doit pas etre restaurable`).toBe(false);
    }
  });

  it("accepte exactement les tables metier deja validees", () => {
    for (const table of RESTORABLE_TABLES) {
      expect(isRestorableTable(table), `${table} devrait etre restaurable`).toBe(true);
    }
  });

  it("verifie le nom de table AVANT de construire du SQL", () => {
    // Le nom vient de la base, mais il sert a nommer une table dans un INSERT.
    // Une valeur stockee n'est pas une valeur sure: le controle doit preceder
    // la construction de la requete, pas la suivre.
    const check = SERVICE.indexOf('reason: "table_not_restorable"');
    const insert = SERVICE.indexOf("INSERT INTO");
    expect(check).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(0);
    expect(check).toBeLessThan(insert);
  });

  it("reimpose l'organisation sur la ligne remise", () => {
    // Sans cela, une entree alteree en base pourrait servir a ecrire chez un
    // autre locataire.
    expect(SERVICE).toContain("organisation_id: orgId");
  });

  it("n'ecrase jamais une ligne existante", () => {
    // Le pire resultat pour une fonction censee proteger des donnees serait
    // d'en detruire en pretendant en sauver.
    expect(SERVICE).toContain("ON CONFLICT DO NOTHING");
    expect(SERVICE).not.toMatch(/DO UPDATE|UPDATE\s+\$\{sql\.identifier/);
  });
});

describe("la protection doit etre atteignable", () => {
  it("ouvre la corbeille a toute personne authentifiee", () => {
    // Un garde de role ici raterait la cible: la restauration de sauvegarde
    // est deja reservee aux administrateurs, et c'est precisement pourquoi
    // elle n'aide pas celui qui vient de se tromper.
    for (const [method, path] of [["get", "/trash"], ["post", "/trash/:id/restore"]] as const) {
      expect(routeFor(method, path).stack.length, `${path} porte un garde de role`).toBe(1);
    }
  });

  it("borne la corbeille au locataire de la session", () => {
    const routes = readFileSync(join(SRC, "routes", "trash.ts"), "utf8");
    expect(routes).toContain("getOrgId(req)");
    // Aucune organisation choisie par l'appelant, sous aucune forme.
    expect(routes).not.toMatch(/req\.(query|body|params)\.organisationId/);
    expect(SERVICE).toContain("eq(deletedRowsTable.organisationId, orgId)");
  });

  it("ne retire l'entree qu'apres une remise reussie", () => {
    // Si l'insert echoue — parent lui-meme supprime — l'utilisateur doit
    // garder sa derniere chance plutot que de perdre la ligne deux fois.
    const insert = SERVICE.indexOf("INSERT INTO");
    const drop = SERVICE.indexOf("db.delete(deletedRowsTable).where(eq(deletedRowsTable.id, entryId))");
    expect(drop).toBeGreaterThan(insert);
  });
});

describe("les suppressions passent bien par la corbeille", () => {
  /**
   * Le defaut vise n'a pas de symptome: une route qui oublie l'archivage
   * supprime exactement comme avant, repond 200, et personne ne s'apercoit de
   * rien — jusqu'au jour ou quelqu'un cherche sa ligne dans la corbeille et ne
   * l'y trouve pas. C'est a ce moment-la que la protection aurait du servir.
   */
  const COVERED = [
    ["prospects.ts", "prospectsTable"],
    ["devis.ts", "devisTable"],
    ["factures-client.ts", "facturesClientTable"],
    ["projets.ts", "projetsTable"],
    ["notes-internes.ts", "notesInternesTable"],
    ["tasks.ts", "tasksTable"],
  ] as const;

  for (const [file, table] of COVERED) {
    it(`${file} archive avant de supprimer`, () => {
      const src = readFileSync(join(SRC, "routes", file), "utf8");
      // C'est la TABLE qu'on passe, pas son nom: elle porte la correspondance
      // entre les champs JavaScript rendus par `.returning()` et les colonnes
      // attendues par la reinsertion. Sans elle, l'entree de corbeille
      // s'affiche normalement et refuse de se restaurer — trouve contre une
      // vraie base, invisible autrement.
      expect(src).toContain(`archiveDeletedRows(${table}`);
      // `.returning({ id })` ne suffit pas non plus: la corbeille a besoin de
      // la ligne entiere. Une selection partielle archiverait une coquille
      // vide, ce qui est pire qu'un archivage absent — la corbeille
      // l'afficherait quand meme.
      expect(src).not.toMatch(new RegExp(`returning\\(\\{ id: \\w+Table\\.id \\}\\)[\\s\\S]{0,400}archiveDeletedRows\\(${table}`));
    });
  }

  it("archive toute suppression d'une table restaurable, sans exception", () => {
    /**
     * Une regle plutot qu'un plafond.
     *
     * La premiere version comptait les suppressions non couvertes et exigeait
     * que le total reste sous un seuil. C'etait le mauvais outil: un chiffre
     * ne dit pas si les 36 restantes sont un travail a faire ou des cas hors
     * sujet, et il autorise silencieusement une nouvelle suppression non
     * archivee tant que le total ne bouge pas.
     *
     * Le critere reel est simple: si la table peut etre restauree, sa
     * suppression DOIT passer par la corbeille. Sinon, il n'y a rien a
     * archiver — la corbeille afficherait une entree qu'elle ne saurait pas
     * remettre, ce qui est pire que de ne rien afficher. Les identifiants
     * d'integration, les comptes, les sauvegardes elles-memes tombent dans ce
     * second cas, et `RESTORABLE_TABLES` a deja tranche pourquoi.
     */
    const routesDir = join(SRC, "routes");
    const gaps: string[] = [];

    for (const name of readdirSync(routesDir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(routesDir, name), "utf8");
      const lines = src.split(/\r?\n/);

      for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i]!.match(/db\.delete\((\w+Table)\)/);
        if (!m) continue;
        const table = m[1]!;
        // Nom de la table en base: `facturesClientTable` -> `factures_client`.
        const dbName = table
          .replace(/Table$/, "")
          .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
          .toLowerCase();
        if (!isRestorableTable(dbName)) continue;

        // L'archivage doit se trouver dans la MEME poignee de route, pas dans
        // une fenetre de quelques lignes: entre la suppression et l'archivage
        // s'intercalent souvent un `.returning()` sur plusieurs lignes et un
        // controle 404. Une fenetre fixe accusait a tort quatre routes deja
        // correctes — et l'elargir jusqu'a les blanchir aurait fini par
        // accepter un archivage appartenant a la route SUIVANTE.
        const end = lines.findIndex((l, k) => k > i && /^router\.(get|post|put|patch|delete)\(/.test(l));
        const handler = lines.slice(i, end < 0 ? lines.length : end).join("\n");
        if (!handler.includes(`archiveDeletedRows(${table}`)) {
          gaps.push(`${name}:${i + 1} supprime ${dbName} sans passer par la corbeille`);
        }
      }
    }

    expect(gaps, gaps.join("\n")).toEqual([]);
  });
});

describe("duree de conservation", () => {
  it("expose la duree pour que l'interface n'en invente pas une autre", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
    const routes = readFileSync(join(SRC, "routes", "trash.ts"), "utf8");
    expect(routes).toContain("TRASH_RETENTION_DAYS");
  });

  it("purge les entrees expirees depuis le cron de retention", () => {
    // Une corbeille sans terme est un second entrepot de donnees personnelles
    // que plus personne ne regarde (art. 5.1.e). Le garde `purge-wiring`
    // exigerait deja un appelant; ici on verifie que c'est le BON.
    const cron = readFileSync(join(SRC, "services", "retention-cron.ts"), "utf8");
    expect(cron).toContain("purgeExpiredTrash");
    expect(cron).toContain("registerRunnableCron");
  });
});
