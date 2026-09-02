/**
 * Avec `min-instances=0`, Cloud Run eteint l'instance des que le trafic cesse
 * et `setInterval` s'arrete avec elle. Une tache planifiee ne tourne donc en
 * production que si elle est inscrite au registre lu par le declencheur externe
 * (/api/cron/tick, appele par Cloud Scheduler) — inscription faite par
 * `withHeartbeat` ou par un appel direct a `registerRunnableCron`.
 *
 * Une tache qui l'oublie ne leve aucune erreur: elle tourne pendant les tests,
 * tourne en developpement, et ne s'execute en production que si un utilisateur
 * se trouve la au bon moment. C'etait le cas du cron des insights IA. Ce test
 * ferme la porte.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICES = join(import.meta.dirname, "..", "services");

/**
 * Boucles volontairement hors registre: elles ne touchent QUE la memoire du
 * processus. Les faire declencher de l'exterieur n'aurait pas de sens — il n'y
 * a rien a rattraper quand l'instance a ete recyclee, le cache est parti avec
 * elle. Toute boucle qui ecrit en base, envoie, ou appelle un fournisseur doit
 * au contraire etre inscrite.
 */
const IN_MEMORY_ONLY = new Set(["ai-cache.ts"]);

/**
 * Boucles ecrites mais jamais demarrees: rien ne les appelle, donc rien a
 * inscrire. `google-drive-backup.ts` expose un planificateur de sauvegarde
 * toutes les 6 h que personne n'appelle — seule la sauvegarde manuelle
 * (bouton) tourne aujourd'hui. Le brancher enverrait des donnees vers le Drive
 * du client: c'est une decision produit, pas une correction technique, donc
 * l'etat est consigne ici plutot que change en douce.
 */
const NEVER_STARTED = new Set(["google-drive-backup.ts"]);

/** Modules qui pilotent une boucle planifiee (hors registre lui-meme). */
function schedulerModules(): Array<{ name: string; source: string }> {
  return readdirSync(SERVICES)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => ({ name: f, source: readFileSync(join(SERVICES, f), "utf8") }))
    .filter(({ name, source }) =>
      name !== "cron-registry.ts" &&
      name !== "health-agents.ts" &&
      !IN_MEMORY_ONLY.has(name) &&
      !NEVER_STARTED.has(name) &&
      /setInterval\(/.test(source) &&
      // `async` inclus: sans lui, ce test ne voyait pas
      // `export async function startGoogleDriveBackupScheduler`.
      /export\s+(?:async\s+)?function\s+start\w+/.test(source));
}

describe("taches planifiees", () => {
  it("detecte bien les modules a controler", () => {
    // Garde-fou du test lui-meme: si la detection tombe a zero, l'assertion
    // suivante passerait pour de mauvaises raisons.
    expect(schedulerModules().length).toBeGreaterThanOrEqual(8);
  });

  it("inscrit chaque cron aupres du declencheur externe", () => {
    const orphans = schedulerModules()
      .filter(({ source }) => !/withHeartbeat\(|registerRunnableCron\(/.test(source))
      .map(({ name }) => name);

    expect(
      orphans,
      `ces crons ne tourneront pas quand l'instance dort: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("publie un battement pour chaque cron, sinon son silence est invisible", () => {
    const silent = schedulerModules()
      .filter(({ source }) => !/withHeartbeat\(|recordCronHeartbeat\(/.test(source))
      .map(({ name }) => name);

    expect(silent).toEqual([]);
  });

  it("verifie que les boucles declarees 'jamais demarrees' le sont vraiment", () => {
    // L'exclusion ci-dessus ne doit pas devenir un mensonge: si quelqu'un
    // branche ce planificateur un jour, il doit repasser par le registre, donc
    // ce test doit tomber et forcer a retirer l'exclusion.
    const src = join(import.meta.dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.includes("__tests__")) files.push(p);
      }
    };
    walk(src);

    for (const moduleName of NEVER_STARTED) {
      const source = readFileSync(join(SERVICES, moduleName), "utf8");
      const starters = [...source.matchAll(/export\s+(?:async\s+)?function\s+(start\w+)/g)].map((m) => m[1]);
      expect(starters.length, `${moduleName} n'expose aucun demarreur`).toBeGreaterThan(0);

      for (const starter of starters) {
        const callers = files.filter((f) => {
          if (f.endsWith(moduleName)) return false;
          return new RegExp("\\b" + starter + "\\s*\\(").test(readFileSync(f, "utf8"));
        });
        expect(
          callers,
          `${starter} est maintenant appele: retirer ${moduleName} de NEVER_STARTED et l'inscrire au registre`,
        ).toEqual([]);
      }
    }
  });

  it("garde des identifiants de verrou distincts", () => {
    // Deux crons partageant un namespace se bloqueraient mutuellement.
    const source = readFileSync(join(import.meta.dirname, "..", "lib", "cron-lock.ts"), "utf8");
    const block = source.slice(source.indexOf("CRON_LOCK_NAMESPACE"), source.indexOf("} as const"));
    const ids = [...block.matchAll(/(\w+):\s*(\d+)/g)].map((m) => Number(m[2]));

    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size, "deux crons partagent le meme namespace de verrou").toBe(ids.length);
  });
});
