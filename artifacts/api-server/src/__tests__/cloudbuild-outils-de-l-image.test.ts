/**
 * Une etape n'appelle un outil que si son IMAGE le contient.
 *
 * Cloud Build execute chaque etape dans une image differente. `git` n'y est
 * pas universel : `gcr.io/google.com/cloudsdktool/cloud-sdk` le contient,
 * `node:24-bookworm-slim` NON — et un binaire absent ne fait pas echouer un
 * script shell ecrit avec `|| true` : il rend une chaine vide, en silence.
 *
 * CE QUE CELA COUTERAIT ICI, precisement. L'etape `deploy-api` lit la date du
 * commit (`git show -s --format=%ct HEAD`) et la publie en
 * `BUILD_COMMIT_TIME`, que `/api/healthz` expose. C'est le SECOND critere de
 * la garde anti-retour — celui qui a ete ajoute apres le 18/09/2026, quand un
 * build plus ancien a ecrase la production parce que le clone en profondeur 1
 * rendait l'ascendance illisible. Sans cette date, la garde du build SUIVANT
 * ne peut plus comparer, et sa regle est explicite : « qui doute laisse
 * passer ». La garde continuerait de tourner, verte, en ne mesurant plus rien.
 *
 * Le controle porte donc sur l'invariant qui rend tout le reste vrai : les
 * etapes qui appellent `git` tournent sur une image qui en dispose.
 *
 * (Piste ouverte par la session Kaverd le 24/09/2026 : chez elle, une etape
 * de test appelait `git ls-files` depuis `node:22-bookworm-slim` — ENOENT, et
 * les 27 etapes suivantes n'ont jamais tourne. Meme cause, autre degat : la
 * leur criait, la notre se tairait.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const YAML = readFileSync(join(RACINE, "deploy", "cloudbuild.yaml"), "utf8").split("\r\n").join("\n");

/**
 * Images dont on sait qu'elles embarquent `git`.
 *
 * Liste volontairement courte : une image ajoutee ici sans verification
 * rouvrirait le trou que ce fichier ferme.
 */
const IMAGES_AVEC_GIT = [
  "gcr.io/google.com/cloudsdktool/cloud-sdk",
  "gcr.io/cloud-builders/git",
  "gcr.io/cloud-builders/gcloud",
];

interface Etape {
  id: string;
  image: string;
  script: string;
}

/** Les etapes du fichier, avec leur image et leur script inline. */
function etapes(): Etape[] {
  const blocs = YAML.split(/\n  - (?=id:|name:)/).slice(1);
  return blocs.map((bloc) => {
    const id = /(?:^|\n)\s*id:\s*(\S+)/.exec(bloc)?.[1] ?? "(sans id)";
    const image = /(?:^|\n)\s*name:\s*'([^']+)'/.exec(bloc)?.[1] ?? "(sans image)";
    return { id, image, script: bloc };
  });
}

/** Un appel a `git` en position de commande, pas le mot « git » dans un commentaire. */
function appelleGit(script: string): boolean {
  return script.split("\n").some((ligne) => {
    const nu = ligne.trim();
    if (nu.startsWith("#") || nu.startsWith("//")) return false;
    return /(^|[;&|(]|\$\(|`|\s)git\s/.test(` ${nu}`);
  });
}

describe("les etapes qui appellent git tournent sur une image qui en a", () => {
  it("le releve trouve bien des etapes (sinon il ne mesure rien)", () => {
    // Garde-fou du controle lui-meme : un fichier restructure rendrait une
    // liste vide, et une liste vide est satisfaite par n'importe quoi.
    const toutes = etapes();
    expect(toutes.length, "aucune etape lue dans deploy/cloudbuild.yaml").toBeGreaterThan(5);
    expect(toutes.filter((e) => e.image !== "(sans image)").length).toBeGreaterThan(5);
  });

  it("au moins une etape appelle git — sinon ce controle est devenu inutile", () => {
    // Si plus personne n'appelle git, c'est que la date du commit vient
    // d'ailleurs : ce fichier doit alors etre relu, pas laisse vert.
    expect(etapes().filter((e) => appelleGit(e.script)).map((e) => e.id).length).toBeGreaterThan(0);
  });

  it("chacune tourne sur une image connue pour embarquer git", () => {
    const fautives = etapes()
      .filter((e) => appelleGit(e.script))
      .filter((e) => !IMAGES_AVEC_GIT.includes(e.image))
      .map((e) => `${e.id} (${e.image})`);
    expect(
      fautives,
      "git absent de l'image : la commande rendra une chaine vide, en silence",
    ).toEqual([]);
  });
});

describe("la date du commit, qui fait vivre la garde anti-retour", () => {
  const deployApi = () => etapes().find((e) => e.id === "deploy-api")!;

  it("elle est lue dans l'etape de deploiement de l'API", () => {
    const e = deployApi();
    expect(e, "etape deploy-api introuvable").toBeTruthy();
    expect(e.script).toMatch(/git show -s --format=%ct HEAD/);
  });

  it("l'image de cette etape en dispose", () => {
    expect(IMAGES_AVEC_GIT).toContain(deployApi().image);
  });

  it("elle est publiee au service, sinon le build suivant ne peut pas comparer", () => {
    expect(deployApi().script).toMatch(/BUILD_COMMIT_TIME=\$\$NOTRE_TS/);
  });

  it("et elle alimente bien la garde, dans cet ordre", () => {
    const s = deployApi().script;
    expect(s.indexOf("NOTRE_TS=")).toBeGreaterThan(-1);
    expect(s.indexOf("garde-ordre-deploiement.sh")).toBeGreaterThan(s.indexOf("NOTRE_TS="));
  });
});
