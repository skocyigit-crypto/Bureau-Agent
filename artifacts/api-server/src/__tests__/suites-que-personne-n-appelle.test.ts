/**
 * Les suites de tests que personne n'appelle.
 *
 * Une suite qui ne tourne pas ressemble exactement a une suite qui passe:
 * dans les deux cas, aucune etape n'est rouge. Le depot en a deja fait les
 * frais — le commentaire de l'etape « Test - buro-ajani » dans ci.yml le dit:
 * « Sa suite existait deja et passait, mais aucune etape ne l'appelait ».
 * 73 000 lignes, l'application que les clients ouvrent tous les jours, et son
 * budget d'accessibilite pouvait casser sans un rouge.
 *
 * Trois facons de perdre une suite sans jamais voir de rouge, mesurees ici:
 *
 *   1. Le nom derive. `pnpm --filter @workspace/nom-qui-a-derive run test`
 *      affiche « No projects matched the filters » et sort en 0 (mesure en
 *      pnpm 9.15). La suite entiere cesse de tourner, la porte reste verte.
 *      Bouche dans .npmrc par fail-if-no-match=true — teste plus bas.
 *
 *   2. Le paquet est ajoute, l'etape ne l'est pas. Rien dans la CI ne relie
 *      « ce paquet declare une suite » a « une etape la lance ».
 *
 *   3. L'etape existe mais porte continue-on-error: true et son identifiant
 *      manque dans la porte. La suite tourne, elle echoue, et personne ne
 *      lit le resultat: c'est le cas le plus silencieux des trois.
 *
 * Ce test tient l'inventaire, pas le code. Il lit le disque et ci.yml, et
 * commence par verifier qu'il a bien trouve quelque chose: un releve vide
 * passerait toutes les assertions suivantes sans rien prouver.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const CI = readFileSync(join(RACINE, ".github", "workflows", "ci.yml"), "utf8");
const NPMRC = readFileSync(join(RACINE, ".npmrc"), "utf8");

/** Les motifs declares sous `packages:` dans pnpm-workspace.yaml. */
function motifsDeLEspaceDeTravail(): string[] {
  const brut = readFileSync(join(RACINE, "pnpm-workspace.yaml"), "utf8");
  const lignes = brut.split("\n");
  const debut = lignes.findIndex((l) => l.trim() === "packages:");
  if (debut === -1) return [];
  const motifs: string[] = [];
  for (const ligne of lignes.slice(debut + 1)) {
    const m = ligne.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
    if (!m) break;
    motifs.push(m[1]!);
  }
  return motifs;
}

/** Les paquets reellement sur le disque, avec ou sans suite declaree. */
function paquets(): { nom: string; chemin: string; suite: boolean }[] {
  const dossiers: string[] = [];
  for (const motif of motifsDeLEspaceDeTravail()) {
    if (motif.endsWith("/*")) {
      const parent = join(RACINE, motif.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const e of readdirSync(parent)) {
        const d = join(parent, e);
        if (statSync(d).isDirectory()) dossiers.push(d);
      }
    } else {
      const d = join(RACINE, motif);
      if (existsSync(d)) dossiers.push(d);
    }
  }
  const trouves: { nom: string; chemin: string; suite: boolean }[] = [];
  for (const d of dossiers) {
    const pj = join(d, "package.json");
    if (!existsSync(pj)) continue;
    const contenu = JSON.parse(readFileSync(pj, "utf8")) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    if (!contenu.name) continue;
    trouves.push({
      nom: contenu.name,
      chemin: relative(RACINE, d).split(sep).join("/"),
      suite: typeof contenu.scripts?.test === "string",
    });
  }
  return trouves;
}

/** Les etapes de ci.yml, decoupees sur l'indentation des listes de `steps:`. */
function etapes(): { texte: string; nom: string; id: string | null; tolerante: boolean }[] {
  return CI.split(/\n(?=      - )/)
    .filter((bloc) => /^\s+- name:/.test(bloc))
    .map((bloc) => ({
      texte: bloc,
      nom: (bloc.match(/- name:\s*(.+)/)?.[1] ?? "").trim(),
      id: bloc.match(/^\s+id:\s*(\S+)/m)?.[1] ?? null,
      tolerante: /^\s+continue-on-error:\s*true\s*$/m.test(bloc),
    }));
}

/**
 * Les lignes de la porte qui font reellement echouer le travail. Un `echo`
 * de l'issue d'une etape n'arrete rien: seul le test qui precede `exit 1`
 * compte. Les distinguer est tout l'objet du troisieme cas.
 */
const VERDICT = CI.split("\n")
  .filter((l) => l.includes('= "failure"'))
  .join("\n");

const PAQUETS = paquets();
const AVEC_SUITE = PAQUETS.filter((p) => p.suite);
const ETAPES = etapes();

describe("les suites de tests que personne n'appelle", () => {
  // Sans ce premier pas, les suivants passeraient sur un releve vide — c'est
  // le defaut meme que ce fichier traque, applique a lui-meme.
  it("le releve a bien lu l'espace de travail", () => {
    expect(motifsDeLEspaceDeTravail().length, "pnpm-workspace.yaml n'a rendu aucun motif").toBeGreaterThanOrEqual(3);
    expect(PAQUETS.length, "aucun paquet trouve sur le disque").toBeGreaterThanOrEqual(10);
    expect(
      AVEC_SUITE.length,
      "aucun paquet ne declare de suite: le releve est casse, pas le depot",
    ).toBeGreaterThanOrEqual(5);
    expect(ETAPES.length, "aucune etape lue dans ci.yml").toBeGreaterThanOrEqual(10);
    expect(VERDICT, "la porte ne contient aucune ligne qui fasse echouer").not.toBe("");
  });

  it("chaque paquet qui declare une suite est lance par une etape", () => {
    const orphelins = AVEC_SUITE.filter(
      (p) => !ETAPES.some((e) => e.texte.includes(`--filter ${p.nom} run test`)),
    );
    expect(
      orphelins.map((p) => `${p.nom} (${p.chemin})`),
      "ces paquets ont une suite que rien ne lance: elle est verte parce qu'elle ne tourne pas",
    ).toEqual([]);
  });

  it("chaque etape de suite est nommee dans la porte qui fait echouer", () => {
    const hors: string[] = [];
    for (const p of AVEC_SUITE) {
      const etape = ETAPES.find((e) => e.texte.includes(`--filter ${p.nom} run test`));
      if (!etape) continue;
      if (!etape.id) {
        hors.push(`${p.nom}: etape « ${etape.nom} » sans id, la porte ne peut pas la lire`);
        continue;
      }
      if (!VERDICT.includes(`steps.${etape.id}.outcome`)) {
        hors.push(`${p.nom}: ${etape.id} absent de la condition d'echec`);
      }
    }
    expect(hors, "une suite qui echoue sans etre lue par la porte ne sert a rien").toEqual([]);
  });

  it("aucune etape toleree n'echappe a la porte", () => {
    const tolerantes = ETAPES.filter((e) => e.tolerante);
    expect(tolerantes.length, "aucune etape toleree: ce test ne mesure plus rien").toBeGreaterThan(0);
    const impunies = tolerantes
      .filter((e) => !e.id || !VERDICT.includes(`steps.${e.id}.outcome`))
      .map((e) => `« ${e.nom} » (id: ${e.id ?? "aucun"})`);
    expect(
      impunies,
      "continue-on-error sans relais dans la porte: l'etape peut echouer sans que rien ne soit rouge",
    ).toEqual([]);
  });

  it("un filtre qui ne correspond a rien fait echouer au lieu de sortir en 0", () => {
    expect(
      NPMRC,
      "sans fail-if-no-match, `pnpm --filter <nom-qui-a-derive>` sort en 0 en silence (mesure en pnpm 9.15)",
    ).toMatch(/^fail-if-no-match\s*=\s*true\s*$/m);
  });
});
