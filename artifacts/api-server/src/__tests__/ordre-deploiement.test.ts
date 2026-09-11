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
 * Le test s'appuie sur de VRAIS commits de ce depot plutot que sur des
 * identifiants inventes: la garde interroge git, donc la seule facon de
 * verifier qu'elle lit correctement une relation d'ascendance est de lui en
 * donner une vraie.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const GARDE = join(RACINE, "deploy", "garde-ordre-deploiement.sh");

/** Rend le code de sortie de la garde: 0 = deployer, 10 = s'abstenir. */
function garde(notre: string, deploye: string): number {
  try {
    execFileSync("bash", [GARDE, notre, deploye], { cwd: RACINE, stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

/** Un commit reel de l'historique, a `n` pas du sommet. */
function commit(n: number): string {
  return execFileSync("git", ["rev-parse", "--short", `HEAD~${n}`], { cwd: RACINE })
    .toString()
    .trim();
}

describe("la production ne recule pas", () => {
  const sommet = commit(0);
  const precedent = commit(1);
  const anterieur = commit(3);

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
