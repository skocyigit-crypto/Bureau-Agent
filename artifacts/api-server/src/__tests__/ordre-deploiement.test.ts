/**
 * Un ancien commit ne doit pas pouvoir ecraser un plus recent en production.
 *
 * Le 11/09/2026, c'est exactement ce qui est arrive: le build de `57a4b87`
 * (cree a 10:23) a fini a 10:48 et a deploye; celui de `f92100f` (cree a
 * 10:08, donc plus ancien) a fini a 10:55 et a deploye PAR-DESSUS. La
 * production est restee cinq heures sur le commit precedent.
 *
 * Aucune alerte ne pouvait se declencher: les deux builds etaient verts, et
 * ils avaient raison de l'etre. Chacun avait fait son travail correctement.
 * C'est l'ORDRE entre eux qui etait faux, et l'ordre n'appartenait a personne.
 *
 * Le test s'appuie sur de VRAIS commits plutot que sur des identifiants
 * inventes: la garde interroge git, donc la seule facon de verifier qu'elle
 * lit correctement une relation d'ascendance est de lui en donner une vraie.
 * Ils sont fabriques dans un depot jetable — voir `depotJetable` pour
 * pourquoi ce n'est pas l'historique de ce depot-ci.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const GARDE = join(RACINE, "deploy", "garde-ordre-deploiement.sh");

/**
 * Un depot jetable avec une vraie chaine de commits.
 *
 * Premiere version: on lisait `HEAD~1` et `HEAD~3` de CE depot. Vert en local,
 * ROUGE en integration continue — la CI clone en profondeur 1, et `HEAD~1`
 * n'existe pas la-bas. Le test dependait d'un historique que la machine qui le
 * fait tourner n'a aucune raison d'avoir.
 *
 * Un depot construit ici est hermetique: il porte la relation d'ascendance
 * qu'on veut eprouver, et rien d'autre. Ce sont toujours de vrais commits,
 * interroges par un vrai `git merge-base` — un identifiant invente ne
 * prouverait rien d'une ascendance.
 */
function depotJetable(): { dossier: string; commits: string[] } {
  const dossier = mkdtempSync(join(tmpdir(), "ordre-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=test", ...args], {
      cwd: dossier,
      stdio: "pipe",
    })
      .toString()
      .trim();

  git("init", "-q");
  const commits: string[] = [];
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(dossier, "f.txt"), `revision ${i}`);
    git("add", "f.txt");
    git("commit", "-q", "-m", `c${i}`);
    commits.push(git("rev-parse", "--short", "HEAD"));
  }
  return { dossier, commits };
}

/**
 * `git` n'existe pas partout ou ces tests tournent.
 *
 * L'etape de test de Cloud Build utilise `node:24-bookworm-slim`, une image
 * sans git: la premiere version de ce fichier y echouait sur `spawnSync git
 * ENOENT` et FAISAIT ECHOUER LE DEPLOIEMENT. Un test cense proteger la mise en
 * production l'empechait — le contraire exact de son objet.
 *
 * Sans git, on ne teste pas moins, on teste AUTRE CHOSE: precisement le
 * comportement que la garde doit avoir dans cet environnement-la, c'est-a-dire
 * laisser passer. Ce n'est pas un test desactive en silence.
 */
function gitDisponible(): boolean {
  try {
    // Le nom du binaire est injectable UNIQUEMENT pour pouvoir eprouver le
    // chemin « sans git » sur une machine qui en a un. Sans cette couture, la
    // branche qui protege le deploiement ne serait jamais executee avant
    // d'atterrir dans le conteneur — c'est-a-dire jamais avant de casser.
    execFileSync(process.env.ORDRE_TEST_GIT ?? "git", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Un depot utilisable, ou rien.
 *
 * `git` peut etre present mais inutilisable: pas de HOME, pas d'identite
 * configuree, systeme de fichiers en lecture seule — autant de cas ordinaires
 * dans un conteneur minimal. Echouer la ferait echouer le deploiement, donc on
 * retombe sur le meme comportement que l'absence de git.
 */
function depotOuRien(): { dossier: string; commits: string[] } | null {
  if (!gitDisponible()) return null;
  try {
    return depotJetable();
  } catch {
    return null;
  }
}

const depot = depotOuRien();
const GIT = depot !== null;
const dossier = depot?.dossier ?? RACINE;
const commits = depot?.commits ?? [];

/**
 * Rend le code de sortie de la garde: 0 = deployer, 10 = s'abstenir.
 *
 * Executee DANS le depot jetable: la garde lit l'historique de son repertoire
 * courant, exactement comme elle le fera dans le plan de travail de Cloud
 * Build.
 */
function garde(notre: string, deploye: string): number {
  try {
    execFileSync("bash", [GARDE, notre, deploye], { cwd: dossier, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

describe.runIf(GIT)("la production ne recule pas", () => {
  // commits[0] est le plus ancien, commits[3] le sommet.
  const sommet = commits[3];
  const precedent = commits[2];
  const anterieur = commits[0];

  it("s'abstient quand notre commit est deja depasse par la production", () => {
    // Le cas exact du 11/09: un build en retard finit apres un plus recent.
    expect(garde(anterieur, sommet), `${anterieur} est un ancetre de ${sommet}`).toBe(10);
    expect(garde(precedent, sommet)).toBe(10);
  });

  it("deploie quand notre commit est en avance sur la production", () => {
    expect(garde(sommet, anterieur)).toBe(0);
    expect(garde(sommet, precedent)).toBe(0);
  });

  it("deploie quand c'est le meme commit", () => {
    // Un redeploiement a l'identique est sans effet de bord; le bloquer
    // empecherait de relancer une mise en service qui a echoue a mi-chemin.
    expect(garde(sommet, sommet)).toBe(0);
  });

  it("deploie plutot que de douter", () => {
    // La regle qui compte: le pire cas d'un faux « deployer » est un
    // redeploiement inutile; celui d'un faux « s'abstenir » est une correction
    // qui n'arrive jamais en production. Les deux ne se valent pas.
    expect(garde("", sommet), "aucun repere fourni").toBe(0);
    expect(garde(sommet, ""), "rien en production").toBe(0);
    expect(garde("0000000", sommet), "commit inconnu de cet historique").toBe(0);
    expect(garde(sommet, "0000000")).toBe(0);
  });
});

/**
 * Ce qui reste verifiable partout, y compris sans git.
 *
 * C'est le comportement le plus important des deux: une garde qui bloque a
 * tort empeche une correction d'arriver en production, alors qu'une garde qui
 * laisse passer a tort ne coute qu'un redeploiement. Ces assertions tournent
 * dans TOUS les environnements — dont l'etape de test de Cloud Build, ou
 * l'absence de git est justement le cas de figure teste.
 */
describe("la garde laisse passer plutot que de bloquer", () => {
  it("laisse passer quand il n'y a rien a comparer", () => {
    expect(garde("", "abc1234"), "aucun repere fourni").toBe(0);
    expect(garde("abc1234", ""), "rien en production").toBe(0);
  });

  it("laisse passer quand elle ne peut pas trancher", () => {
    // Sans historique utilisable — pas de git, ou commits inconnus — la garde
    // n'a aucune raison de retenir un deploiement.
    expect(garde("0000000", "1111111")).toBe(0);
  });

  it("dit dans quel mode ce fichier vient de tourner", () => {
    // Sans cette ligne, un environnement qui perdrait git verrait la moitie
    // des tests disparaitre sans que personne ne le remarque.
    console.log(GIT
      ? "[ordre-deploiement] git present: ascendance reellement verifiee"
      : "[ordre-deploiement] git absent: seul le comportement fail-open est verifie");
    expect(typeof GIT).toBe("boolean");
  });
});
