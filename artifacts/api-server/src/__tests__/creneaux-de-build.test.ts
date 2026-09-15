/**
 * Le type de machine decide du nombre de builds simultanes — pas le quota.
 *
 * Le quota regional des builds declenches vaut 10 PROCESSEURS simultanes, pas
 * 10 builds. C'est une distinction qui ne se voit nulle part dans la console
 * et qui change tout: a huit processeurs par build, un seul tient, et deux
 * processeurs restent inutilisables.
 *
 * Mesure sur dix-neuf builds du projet, avant correction:
 *
 *     attente avant demarrage   20,5 min en moyenne (70,6 min au pire)
 *     duree du build             6,1 min
 *
 * Quatre depots partagent ce quota. L'attente ne venait donc pas d'une
 * surcharge, mais d'une division: 10 / 8 = 1.
 *
 * Ce test existe parce que la prochaine personne qui voudra « des builds plus
 * rapides » remontera naturellement le type de machine — et divisera par deux
 * le nombre de creneaux sans qu'aucune erreur ne le signale. Le build serait
 * effectivement plus court; c'est le temps total qui doublerait.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require("js-yaml");

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const PIPELINE = yaml.load(
  readFileSync(join(RACINE, "deploy", "cloudbuild.yaml"), "utf8"),
) as { options?: { machineType?: string } };

/** Quota regional, en processeurs simultanes, pour les builds declenches. */
const QUOTA_PROCESSEURS = 10;

/** Processeurs consommes par type de machine Cloud Build. */
const PROCESSEURS: Record<string, number> = {
  E2_HIGHCPU_8: 8,
  E2_HIGHCPU_32: 32,
  E2_MEDIUM: 1,
  N1_HIGHCPU_8: 8,
  N1_HIGHCPU_32: 32,
  E2_HIGHCPU_4: 4,
};

function processeursParBuild(): number {
  const type = PIPELINE.options?.machineType ?? "E2_MEDIUM";
  const n = PROCESSEURS[type];
  expect(n, `type de machine inconnu de ce test: ${type} — ajouter sa taille ci-dessus`).toBeDefined();
  return n;
}

describe("le nombre de builds qui peuvent tourner ensemble", () => {
  it("il en tient au moins deux dans le quota", () => {
    const creneaux = Math.floor(QUOTA_PROCESSEURS / processeursParBuild());
    expect(
      creneaux,
      `avec ${processeursParBuild()} processeurs par build et un quota de ${QUOTA_PROCESSEURS}, ` +
        "un seul build tient a la fois — et quatre depots se partagent ce creneau unique. " +
        "Le build serait plus court, le temps total plus long.",
    ).toBeGreaterThanOrEqual(2);
  });

  it("le quota n'est pas depasse par deux builds", () => {
    // L'erreur inverse: descendre si bas qu'on gaspille le quota sans gagner
    // de creneau utile.
    expect(2 * processeursParBuild()).toBeLessThanOrEqual(QUOTA_PROCESSEURS);
  });

  it("la machine reste assez grande pour porter la suite de tests", () => {
    // La porte de qualite execute les cinq suites dans le build. Descendre a
    // un processeur rendrait l'attente plus courte et le build interminable —
    // et rouvrirait la porte aux tests sensibles au temps.
    expect(processeursParBuild()).toBeGreaterThanOrEqual(4);
  });

  it("le type de machine est declare explicitement", () => {
    // Sans declaration, Cloud Build retombe sur une machine d'un processeur:
    // le calcul ci-dessus deviendrait faux sans que rien ne change dans le
    // fichier.
    expect(PIPELINE.options?.machineType).toBeDefined();
  });
});
