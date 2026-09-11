/**
 * Les etapes de deploiement contiennent maintenant du shell. Ce fichier
 * verifie qu'il est valide et qu'il fait ce qu'il annonce.
 *
 * Pourquoi ce test existe: on ne peut pas lancer Cloud Build ici, et une
 * erreur de syntaxe dans ces quelques lignes ne se decouvrirait qu'au moment
 * de mettre en production — c'est-a-dire au pire moment, sur le chemin par
 * lequel passent TOUTES les corrections. Un `bash -n` coute une milliseconde
 * et ferme exactement ce trou.
 *
 * Le piege propre a Cloud Build est l'echappement: `$$` dans le YAML devient
 * `$` dans le shell execute, et `${_TAG}` est remplace par Cloud Build AVANT
 * que bash ne voie la ligne. Un `$` ecrit simple serait donc mange par la
 * substitution, silencieusement, et la variable serait vide a l'execution.
 * On rejoue ici les deux transformations avant de verifier la syntaxe.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
// Fins de ligne normalisees: le depot est edite depuis Windows, et une
// extraction qui cherche "\n" rendrait des chaines vides sur un fichier en
// CRLF — le test passerait alors sans rien lire.
const YAML = readFileSync(join(RACINE, "deploy", "cloudbuild.yaml"), "utf8").split("\r\n").join("\n");

/** Le script inline d'une etape, tel que bash le recevra. */
function scriptDe(idEtape: string): string {
  const debut = YAML.indexOf(`  - id: ${idEtape}`);
  expect(debut, `etape « ${idEtape} » introuvable`).toBeGreaterThan(-1);
  const apres = YAML.slice(debut);
  const bloc = apres.slice(apres.indexOf("      - |\n") + "      - |\n".length);
  const lignes: string[] = [];
  for (const ligne of bloc.split("\n")) {
    // Le bloc s'arrete a la premiere ligne moins indentee et non vide.
    if (ligne.trim() !== "" && !ligne.startsWith("        ")) break;
    lignes.push(ligne.slice(8));
  }
  return lignes
    .join("\n")
    // Cloud Build remplace ses substitutions avant bash.
    .replace(/\$\{_[A-Z_]+\}/g, "valeur-de-substitution")
    .replace(/\$\{PROJECT_ID\}|\$\{BUILD_ID\}/g, "valeur-de-substitution")
    // ... puis `$$` devient `$`.
    .replace(/\$\$/g, "$");
}

const ETAPES = ["deploy-api", "deploy-web", "deploy-tanitim"];

describe("le shell des etapes de deploiement", () => {
  it("trouve bien les trois etapes", () => {
    // Garde-fou: si l'extraction rendait des chaines vides, `bash -n` les
    // validerait toutes sans rien lire.
    for (const id of ETAPES) {
      expect(scriptDe(id).length, `${id} : script vide`).toBeGreaterThan(100);
    }
  });

  it("est syntaxiquement valide", () => {
    const dossier = mkdtempSync(join(tmpdir(), "cb-"));
    for (const id of ETAPES) {
      const f = join(dossier, `${id}.sh`);
      writeFileSync(f, scriptDe(id));
      expect(() => execFileSync("bash", ["-n", f], { stdio: "pipe" }), `${id} : syntaxe invalide`).not.toThrow();
    }
  });

  it("n'utilise jamais un `$` simple pour une variable de shell", () => {
    // `$DEPLOYE` au lieu de `$$DEPLOYE` serait consomme par Cloud Build et
    // arriverait vide: la garde comparerait alors a rien, laisserait passer,
    // et le probleme qu'elle corrige reviendrait sans bruit.
    for (const id of ETAPES) {
      // Borne a l'etape elle-meme. Une premiere version prenait 4000
      // caracteres a partir du debut et debordait sur le commentaire des
      // substitutions, qui mentionne `_TAG=$SHORT_SHA`: le test signalait une
      // faute dans un texte qu'il n'aurait jamais du lire.
      // La borne est l'etape suivante OU la prochaine cle de premier niveau:
      // `deploy-tanitim` est la derniere etape, et sans cette seconde borne la
      // tranche allait jusqu'a la fin du fichier.
      const debut = YAML.indexOf(`  - id: ${id}`);
      const bornes = [YAML.indexOf("\n  - id: ", debut + 1), YAML.slice(debut).search(/\n[a-z]+:/)]
        .map((n, i) => (n === -1 ? -1 : i === 1 ? debut + n : n))
        .filter((n) => n > debut);
      const brut = YAML.slice(debut, bornes.length ? Math.min(...bornes) : YAML.length);
      const simples = [...brut.matchAll(/(?<![$\\])\$(?!\$)(?!\{_)(?!\{PROJECT_ID)(?!\{BUILD_ID)([A-Za-z_?(])/g)];
      expect(simples.map((m) => m[0]), `${id} : variable shell non echappee`).toEqual([]);
    }
  });
});

describe("l'ordre des deploiements est garde", () => {
  it("l'API consulte la garde avant de deployer", () => {
    const api = scriptDe("deploy-api");
    expect(api).toContain("garde-ordre-deploiement.sh");
    // La garde doit etre consultee AVANT le deploiement, pas apres.
    expect(api.indexOf("garde-ordre-deploiement.sh")).toBeLessThan(api.indexOf("gcloud run deploy"));
  });

  it("l'interface et la vitrine s'abstiennent avec l'API", () => {
    // Une interface plus recente que son API appelle des routes qui n'existent
    // pas encore: les trois services avancent ensemble ou pas du tout.
    for (const id of ["deploy-web", "deploy-tanitim"]) {
      const s = scriptDe(id);
      expect(s, `${id} ne lit pas le temoin`).toContain(".deploiement-depasse");
      expect(s.indexOf(".deploiement-depasse")).toBeLessThan(s.indexOf("gcloud run deploy"));
    }
  });

  it("l'API pose le temoin quand elle s'abstient", () => {
    expect(scriptDe("deploy-api")).toContain("touch /workspace/.deploiement-depasse");
  });
});
