/**
 * Un pipeline que Cloud Build REFUSE ne deploie rien — et ne le dit qu'apres.
 *
 * Mesure du 15/09: la fusion du #136 a produit, en trois secondes,
 *
 *     invalid value for 'build.substitutions':
 *     key in the template "PROXY" is not a valid built-in substitution
 *
 * Aucune etape n'a demarre. La cause etait invisible a la relecture: le script
 * qui a insere l'etape de migration passait le texte a `String.replace`, qui
 * interprete `$$` comme un `$` litteral. Les cinq echappements shell du bloc
 * (`$$!`, `$$(seq ...)`, `$$i`, `$$(node ...)`, `$$PROXY`) sont donc arrives
 * dans le fichier en `$`, c'est-a-dire en references de substitution.
 *
 * Le test de l'ordre des etapes (migration-avant-deploiement) etait vert: il
 * verifiait que le schema passe avant le code, pas que le pipeline est
 * seulement ACCEPTABLE. Un fichier syntaxiquement valide, correctement
 * ordonne, et rejete a l'entree.
 *
 * Regle: dans un script d'etape, `$X` appartient a Cloud Build, `$$X` au shell.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require("js-yaml");

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const CHEMIN = join(RACINE, "deploy", "cloudbuild.yaml");
const BRUT = readFileSync(CHEMIN, "utf8");

type Etape = { id?: string; args?: unknown[]; entrypoint?: string; secretEnv?: string[] };
type Pipeline = {
  steps: Etape[];
  substitutions?: Record<string, string>;
  availableSecrets?: { secretManager?: Array<{ versionName?: string; env?: string }> };
};

const PIPELINE = yaml.load(BRUT) as Pipeline;

/** Substitutions fournies par Cloud Build lui-meme. */
const INTEGREES = new Set([
  "PROJECT_ID", "BUILD_ID", "PROJECT_NUMBER", "LOCATION", "TRIGGER_NAME",
  "COMMIT_SHA", "SHORT_SHA", "REVISION_ID", "REPO_NAME", "REPO_FULL_NAME",
  "BRANCH_NAME", "TAG_NAME", "SERVICE_ACCOUNT_EMAIL", "SERVICE_ACCOUNT",
  "TRIGGER_BUILD_CONFIG_PATH",
]);

const DECLAREES = new Set(Object.keys(PIPELINE.substitutions ?? {}));

/**
 * Toutes les references `$X` / `${X}` a un `$` impair (donc non echappees).
 *
 * Cloud Build ne reconnait que les noms en MAJUSCULES: c'est pourquoi le
 * `$attempt` de l'attente de la base de test traverse sans bruit depuis des
 * mois, alors que `$PROXY` a fait tomber le build a la seconde. La regle ne
 * figure pas dans le message d'erreur; elle se deduit du fait que les deux
 * coexistaient dans le meme fichier, l'un accepte, l'autre non.
 */
function referencesNonEchappees(texte: string): string[] {
  const trouvees: string[] = [];
  for (const m of texte.matchAll(/(\$+)\{?([A-Z_][A-Z0-9_]*)\}?/g)) {
    if (m[1].length % 2 === 0) continue; // $$X : echappe, destine au shell
    trouvees.push(m[2]);
  }
  return trouvees;
}

function scriptsDEtapes(): Array<{ id: string; texte: string }> {
  return PIPELINE.steps.flatMap((e) =>
    (e.args ?? [])
      .filter((a): a is string => typeof a === "string")
      .map((texte) => ({ id: e.id ?? "(sans id)", texte })),
  );
}

describe("les references du pipeline sont toutes resolubles par Cloud Build", () => {
  it("il y a bien des scripts d'etapes a examiner", () => {
    // Garde-fou: si le fichier change de forme, les tests suivants
    // passeraient sur un ensemble vide, sans rien prouver.
    expect(scriptsDEtapes().length).toBeGreaterThanOrEqual(5);
  });

  it("aucune reference inconnue de Cloud Build", () => {
    const inconnues = scriptsDEtapes().flatMap(({ id, texte }) =>
      referencesNonEchappees(texte)
        .filter((n) => !INTEGREES.has(n) && !DECLAREES.has(n) && !DECLAREES.has(`_${n}`))
        .map((n) => `${id}: $${n}`),
    );
    expect(
      inconnues,
      "ces references ne sont ni des substitutions integrees ni declarees. " +
        "Si elles visent le shell, il faut les ecrire `$$`; sinon, les declarer " +
        "dans `substitutions:`. Cloud Build refuse le build a l'entree, avant " +
        "toute etape, et rien n'est deploye.",
    ).toEqual([]);
  });

  it("les variables shell de l'etape de migration sont echappees", () => {
    const etape = PIPELINE.steps.find((e) => e.id === "migration-schema-prod");
    expect(etape, "l'etape de migration a disparu").toBeDefined();
    const texte = (etape!.args ?? []).filter((a): a is string => typeof a === "string").join("\n");
    for (const attendu of ["$$!", "$$(seq", "$$i", "$$PROXY"]) {
      expect(texte, `echappement perdu: ${attendu}`).toContain(attendu);
    }
  });

  it("le PID du proxy n'est jamais lu sans echappement", () => {
    const texte = BRUT;
    // `$PROXY` seul (precede d'un nombre pair de $) est la panne exacte du 15/09.
    expect(/(^|[^$])\$PROXY/m.test(texte), "`$PROXY` non echappe est revenu").toBe(false);
  });

  it("les substitutions personnalisees commencent par un tiret bas", () => {
    // Cloud Build reserve l'espace de noms sans tiret bas a ses propres cles.
    for (const cle of DECLAREES) {
      expect(cle.startsWith("_"), `substitution invalide: ${cle}`).toBe(true);
    }
  });

  it("l'instance Cloud SQL visee par la migration est declaree", () => {
    expect(DECLAREES.has("_SQL_INSTANCE")).toBe(true);
    expect(DECLAREES.has("_SQL_REGION")).toBe(true);
  });

  it("le secret de connexion est fourni au build, pas ecrit en clair", () => {
    const envs = (PIPELINE.availableSecrets?.secretManager ?? []).map((s) => s.env);
    expect(envs).toContain("DATABASE_URL_PROD");
    // Le pipeline contient bien une URL Postgres en clair, et c'est voulu:
    // celle de la base jetable du conteneur de test, creee et detruite dans le
    // build. Ce qui ne doit jamais y figurer, c'est une URL qui pointe
    // ailleurs que sur ce conteneur ou sur la machine du build.
    const HOTES_JETABLES = ["agent-bureau-ci-postgres", "127.0.0.1", "localhost"];
    const hotes = [
      ...BRUT.matchAll(/postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@([^\s"':/]+)/g),
    ].map((m) => m[1]);
    expect(hotes.length, "plus aucune URL Postgres: le test ne prouve plus rien").toBeGreaterThan(
      0,
    );
    for (const hote of hotes) {
      expect(HOTES_JETABLES, `mot de passe en clair pour l'hote ${hote}`).toContain(hote);
    }
  });

  it("l'etape de migration reclame ce secret", () => {
    const etape = PIPELINE.steps.find((e) => e.id === "migration-schema-prod");
    expect(etape?.secretEnv).toContain("DATABASE_URL_PROD");
  });

  it("chaque etape porte un identifiant", () => {
    // Sans id, `waitFor` ne peut pas la nommer et l'ordre devient implicite.
    const anonymes = PIPELINE.steps.filter((e) => !e.id);
    expect(anonymes.length).toBe(0);
  });

  it("l'etape de migration installe les certificats du systeme", () => {
    // Le proxy Cloud SQL est un binaire Go: il verifie les certificats avec le
    // magasin DU SYSTEME. L'image `node:*-slim` n'en contient aucun. Node,
    // lui, embarque le sien — d'ou une panne particulierement trompeuse,
    // mesuree le 15/09: le telechargement du proxy (fait par Node) reussit, et
    // c'est la connexion du proxy qui tombe sur
    // « x509: certificate signed by unknown authority ».
    const etape = PIPELINE.steps.find((e) => e.id === "migration-schema-prod");
    const texte = (etape?.args ?? []).filter((a): a is string => typeof a === "string").join("\n");
    expect(texte, "sans ca-certificates, le proxy ne peut joindre aucune instance").toContain(
      "ca-certificates",
    );
  });

  it("l'attente du tunnel verifie la base, pas seulement le port", () => {
    // Le proxy ouvre son ecoute locale immediatement, avant de savoir s'il
    // peut joindre l'instance: une connexion TCP reussit donc alors que rien
    // ne fonctionne. Le 15/09, l'attente est passee et l'echec est apparu
    // trois lignes plus loin, sur la premiere migration — au mauvais endroit,
    // avec le mauvais message.
    const etape = PIPELINE.steps.find((e) => e.id === "migration-schema-prod");
    const texte = (etape?.args ?? []).filter((a): a is string => typeof a === "string").join("\n");
    expect(
      /select\s+1/i.test(texte),
      "l'attente doit faire une vraie requete: un port ouvert ne prouve rien",
    ).toBe(true);
  });

  it("le fichier reste un YAML que l'outillage sait relire", () => {
    expect(Array.isArray(PIPELINE.steps)).toBe(true);
    expect(PIPELINE.steps.length).toBeGreaterThanOrEqual(8);
  });
});
