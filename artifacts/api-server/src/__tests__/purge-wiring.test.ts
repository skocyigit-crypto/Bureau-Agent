import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Toute purge ecrite doit etre appelee par quelque chose.
 *
 * C'est le pendant de `cron-registration.test.ts`. Celui-la verifie qu'une
 * boucle planifiee est inscrite au registre; celui-ci verifie l'etage
 * d'avant — qu'il existe seulement un appelant.
 *
 * Le defaut vise n'a AUCUN symptome. La fonction compile, ses tests unitaires
 * passent si on en ecrit, le serveur demarre, rien n'echoue. La table grossit,
 * simplement. `purgeOldSecurityScans` a vecu ainsi du 23 juillet au 3
 * septembre 2026: ecrite avec un commentaire disant que la table « grossit
 * indefiniment », et jamais branchee. Six semaines.
 *
 * Et l'enjeu depasse la place disque: une purge non branchee, c'est une duree
 * de conservation annoncee mais pas tenue — l'article 5.1.e du RGPD, celui-la
 * meme que `retention-cron` a ete ecrit pour appliquer.
 */

const SRC = join(import.meta.dirname, "..");

/** Tous les fichiers TypeScript du serveur, tests compris. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const FILES = sources(SRC);

/**
 * Purges connues et volontairement sans appelant automatique.
 *
 * Vide aujourd'hui, et c'est le but: y ajouter une entree demande d'ecrire
 * POURQUOI la purge ne tourne pas, ce qui est precisement l'information qui
 * manquait pendant six semaines.
 */
const DELIBERATELY_UNWIRED = new Map<string, string>();

describe("les purges sont branchees", () => {
  it("trouve un appelant pour chaque fonction de purge exportee", () => {
    const declarations: Array<{ name: string; file: string }> = [];
    for (const file of FILES) {
      if (file.includes("__tests__")) continue;
      const src = readFileSync(file, "utf8");
      // `purgeX`, `cleanupX`, `pruneX`: les trois formes employees ici pour
      // « supprimer des lignes anciennes ».
      for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+((?:purge|cleanup|prune)[A-Z]\w*)/g)) {
        declarations.push({ name: m[1]!, file });
      }
    }

    // Si le motif ne trouve plus rien, le test ne verifie plus rien: il
    // passerait au vert en ayant cesse de regarder.
    expect(declarations.length, "aucune fonction de purge trouvee").toBeGreaterThan(0);

    const orphans: string[] = [];
    for (const { name, file } of declarations) {
      if (DELIBERATELY_UNWIRED.has(name)) continue;

      // On compte les SITES D'APPEL, pas les fichiers. Ecarter le fichier
      // declarant serait faux: une purge appelee depuis la boucle definie
      // juste au-dessus d'elle est parfaitement branchee — c'est le cas de
      // `purgeExpiredCallRecordings` et de `purgeOldAiUsage`, que la premiere
      // version de ce test signalait a tort. Un import ne compte pas: il n'a
      // pas de parenthese ouvrante.
      let callSites = 0;
      for (const f of FILES) {
        callSites += (readFileSync(f, "utf8").match(new RegExp(`\\b${name}\\s*\\(`, "g")) || []).length;
      }
      // La declaration elle-meme en fournit un: au-dela, c'est un appel.
      if (callSites <= 1) orphans.push(`${name} (${file.slice(SRC.length + 1)})`);
    }

    expect(
      orphans,
      "purges ecrites que rien n'appelle — la table grossit sans terme, et la " +
        "duree de conservation annoncee n'est pas tenue:\n" + orphans.join("\n"),
    ).toEqual([]);
  });

  it("fait tourner la purge des analyses de securite avec les autres", () => {
    // Un appelant peut exister sans que la purge tourne pour autant: seule
    // l'inscription au registre la fait executer en production, ou l'instance
    // s'eteint des que le trafic cesse.
    const cron = readFileSync(join(SRC, "services", "retention-cron.ts"), "utf8");
    expect(cron).toContain("purgeOldSecurityScans");
    expect(cron).toContain("registerRunnableCron");
  });
});
