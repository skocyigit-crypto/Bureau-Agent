/**
 * Le type de machine decide du nombre de builds simultanes — et la liste des
 * types possibles est fermee.
 *
 * Le quota regional des builds declenches vaut 10 PROCESSEURS simultanes, pas
 * 10 builds. C'est une distinction qui ne se voit nulle part dans la console
 * et qui change tout: a huit processeurs par build, un seul tient, et deux
 * processeurs restent inutilisables.
 *
 * Mesure sur dix-neuf builds du projet:
 *
 *     attente avant demarrage   20,5 min en moyenne (70,6 min au pire)
 *     duree du build             6,1 min
 *
 * Quatre depots partagent ce quota. L'attente ne vient donc pas d'une
 * surcharge, mais d'une division: 10 / 8 = 1.
 *
 * ── Ce que la premiere version de ce test a rate ──────────────────────────
 *
 * Elle repondait a ce constat en passant la machine a `E2_HIGHCPU_4`, pour
 * obtenir deux creneaux. Le test etait vert. Cloud Build a refuse le build a
 * l'entree:
 *
 *     failed unmarshalling build config deploy/cloudbuild.yaml:
 *     unknown value "E2_HIGHCPU_4" for enum BuildOptions.MachineType
 *
 * Ce palier n'existe pas. Et le test ne pouvait pas le dire, parce qu'il
 * lisait la taille du type dans une table ecrite a la main — ou le type
 * invente avait ete ajoute en meme temps que lui. Un test qui valide une
 * valeur contre sa propre hypothese ne valide rien; il ne fait que la
 * repeter.
 *
 * D'ou la table `MACHINES` ci-dessous: elle n'est plus une commodite de
 * calcul, elle est la LISTE FERMEE des valeurs que Cloud Build accepte. Toute
 * autre valeur fait echouer le test, au lieu d'attendre le prochain
 * deploiement pour se manifester.
 *
 * ── Ou en est-on ──────────────────────────────────────────────────────────
 *
 * Il n'existe aucun palier entre 1 et 8 processeurs. Les deux creneaux ne
 * sont donc PAS atteignables par le type de machine: soit un build a huit
 * processeurs (un creneau, builds rapides), soit des builds a un processeur
 * (dix creneaux, mais la porte de qualite et ses cinq suites deviennent
 * interminables, et les tests sensibles au temps redeviennent instables).
 *
 * Le seul vrai levier est donc une AUGMENTATION DE QUOTA
 * (`concurrent_public_pool_build_cpus`), qui se demande a Google. Tant
 * qu'elle n'est pas accordee, un creneau est le choix correct, et ce test
 * verrouille ce qui peut encore casser: un type de machine inexistant.
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

/**
 * Les SEULS types de machine que Cloud Build accepte, et leur taille en
 * processeurs. Cette table n'est pas indicative: toute valeur absente d'ici
 * fait refuser le build a l'entree, avant qu'aucune etape ne demarre.
 */
const MACHINES: Record<string, number> = {
  E2_MEDIUM: 1,
  E2_HIGHCPU_8: 8,
  E2_HIGHCPU_32: 32,
  N1_HIGHCPU_8: 8,
  N1_HIGHCPU_32: 32,
};

function typeDeclare(): string {
  const type = PIPELINE.options?.machineType;
  expect(type, "aucun type de machine declare").toBeDefined();
  return type!;
}

function processeursParBuild(): number {
  return MACHINES[typeDeclare()];
}

describe("le type de machine du pipeline", () => {
  it("existe reellement chez Cloud Build", () => {
    // La panne du 15/09, en une ligne: `E2_HIGHCPU_4` se lit tres bien et
    // n'existe pas. Le build est refuse a l'entree, rien n'est deploye, et le
    // message n'arrive que dans la console.
    expect(
      Object.keys(MACHINES),
      `« ${typeDeclare()} » n'est pas un type de machine Cloud Build. ` +
        "Le build sera refuse avant toute etape.",
    ).toContain(typeDeclare());
  });

  it("est declare explicitement", () => {
    // Sans declaration, Cloud Build retombe sur une machine d'un processeur:
    // le calcul de creneaux ci-dessous deviendrait faux sans qu'une seule
    // ligne du fichier n'ait change.
    expect(PIPELINE.options?.machineType).toBeDefined();
  });

  it("tient dans le quota regional", () => {
    // Un build qui depasse a lui seul le quota ne demarrerait jamais.
    expect(processeursParBuild()).toBeLessThanOrEqual(QUOTA_PROCESSEURS);
  });

  it("reste assez grand pour porter la porte de qualite", () => {
    // La porte de qualite execute cinq suites dans le build. Descendre a un
    // processeur rendrait l'attente plus courte et le build interminable — et
    // rouvrirait la porte aux tests sensibles au temps.
    expect(processeursParBuild()).toBeGreaterThanOrEqual(8);
  });
});

describe("le nombre de builds simultanes", () => {
  it("se calcule en processeurs, pas en builds", () => {
    // C'est la donnee qui manquait a tout le monde: le quota porte sur des
    // processeurs. A huit par build, il n'en tient qu'un.
    const creneaux = Math.floor(QUOTA_PROCESSEURS / processeursParBuild());
    expect(creneaux).toBe(1);
  });

  it("aucun palier intermediaire ne permet d'en obtenir deux", () => {
    // Verifie la conclusion plutot que de la laisser en commentaire: parmi
    // les types reellement acceptes, aucun ne donne deux creneaux tout en
    // gardant une machine capable de porter la suite de tests (>= 8).
    const deuxCreneauxEtAssezGros = Object.values(MACHINES).filter(
      (cpu) => cpu >= 8 && Math.floor(QUOTA_PROCESSEURS / cpu) >= 2,
    );
    expect(
      deuxCreneauxEtAssezGros,
      "si un tel palier apparait un jour, ce test tombe et il faut en profiter",
    ).toEqual([]);
  });

  it("deux creneaux demanderaient un quota d'au moins seize processeurs", () => {
    // Le chiffre a demander a Google, calcule et non recopie.
    expect(2 * processeursParBuild()).toBe(16);
  });
});
