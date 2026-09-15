/**
 * Le schema part AVANT le code, et rien ne se deploie s'il n'est pas passe.
 *
 * Cette regle etait ecrite dans les commentaires du depot et dans le message
 * du #78 en toutes lettres — « le schema doit etre pousse en production AVANT
 * la fusion ». Elle dependait d'une personne qui s'en souvienne. Le
 * 11 septembre 2026, personne ne s'en est souvenu, et la production a passe
 * QUATRE JOURS avec:
 *
 *   - 1011 erreurs « column "created_by_agent" does not exist »;
 *   - le moteur d'automatisation en echec toutes les cinq minutes;
 *   - le panneau « activite recente » du tableau de bord en 500;
 *   - toute lecture complete de `tasks` cassee: liste des taches, export de
 *     donnees, operations en masse.
 *
 * Une regle qui repose sur la memoire n'est pas une regle. La migration fait
 * desormais partie du deploiement, et ce fichier defend les trois proprietes
 * qui la rendent sure. Chacune correspond a une facon precise de recreer la
 * panne sans s'en apercevoir.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require("js-yaml");

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const PIPELINE = yaml.load(
  readFileSync(join(RACINE, "deploy", "cloudbuild.yaml"), "utf8"),
) as { steps: Array<{ id?: string; waitFor?: string[]; args?: string[]; secretEnv?: string[] }>;
       availableSecrets?: { secretManager?: Array<{ env?: string }> };
       substitutions?: Record<string, string> };

const etape = (id: string) => PIPELINE.steps.find((s) => s.id === id);

describe("l'ordre entre le schema et le code", () => {
  it("la migration existe dans le pipeline", () => {
    expect(
      etape("migration-schema-prod"),
      "la migration a disparu du deploiement: on est revenu a la poussee manuelle, " +
        "celle qui a coute quatre jours de panne",
    ).toBeDefined();
  });

  it("le deploiement de l'API attend la migration", () => {
    expect(etape("deploy-api")?.waitFor).toContain("migration-schema-prod");
  });

  it("l'interface et la vitrine ne peuvent pas partir avant l'API", () => {
    // Sinon l'interface arriverait devant une API qui n'a pas encore sa base:
    // l'utilisateur verrait des ecrans vides sans message.
    expect(etape("deploy-web")?.waitFor).toContain("deploy-api");
    expect(etape("deploy-tanitim")?.waitFor).toContain("deploy-api");
  });

  it("aucun deploiement ne precede la migration dans la chaine", () => {
    // Verification transitive: on remonte les dependances de chaque etape de
    // deploiement jusqu'a trouver la migration.
    const parId = new Map(PIPELINE.steps.map((s) => [s.id!, s]));
    const atteint = (depart: string, cible: string, vus = new Set<string>()): boolean => {
      if (depart === cible) return true;
      if (vus.has(depart)) return false;
      vus.add(depart);
      return (parId.get(depart)?.waitFor ?? []).some((p) => atteint(p, cible, vus));
    };

    for (const id of ["deploy-api", "deploy-web", "deploy-tanitim"]) {
      expect(
        atteint(id, "migration-schema-prod"),
        `${id} peut se declencher sans que la migration soit passee`,
      ).toBe(true);
    }
  });
});

describe("ce qui rend la migration sure", () => {
  const script = () => (etape("migration-schema-prod")?.args ?? []).join("\n");

  it("le garde-fou anti-perte s'execute AVANT la poussee", () => {
    // `push --force` ne pose aucune question, pas meme pour supprimer une
    // table. Le garde-fou apres coup ne servirait a rien.
    const s = script();
    const iGarde = s.indexOf("schema-guard.mjs");
    const iPoussee = s.indexOf("drizzle-kit push");
    expect(iGarde, "schema-guard a disparu").toBeGreaterThan(-1);
    expect(iGarde, "le garde-fou s'execute apres la poussee: il ne protege plus rien").toBeLessThan(iPoussee);
  });

  it("la poussee est verifiee apres coup", () => {
    // Une poussee qui « reussit » sans creer la colonne attendue ne se voit
    // sinon qu'a la premiere requete d'un vrai client, en 500.
    expect(script()).toContain("verify-schema-sync.mjs");
  });

  it("le mot de passe vient de Secret Manager, jamais d'une substitution", () => {
    // Une substitution apparait dans les journaux du build; un secret non.
    expect(etape("migration-schema-prod")?.secretEnv).toContain("DATABASE_URL_PROD");
    expect(PIPELINE.availableSecrets?.secretManager?.[0]?.env).toBe("DATABASE_URL_PROD");
    expect(
      JSON.stringify(PIPELINE.substitutions ?? {}),
      "un mot de passe est passe par substitution: il finira dans les journaux",
    ).not.toMatch(/password|mot_de_passe|DATABASE_URL/i);
  });

  it("l'instance visee est nommee explicitement", () => {
    // Le projet heberge quatre bases. Viser « celle de la configuration
    // courante » ferait migrer la mauvaise.
    expect(PIPELINE.substitutions?._SQL_INSTANCE).toBe("agent-de-bureau-db");
  });

  it("l'echec de la migration arrete tout", () => {
    // `-e` dans les options du shell: une commande qui echoue interrompt
    // l'etape, donc le build, donc le deploiement. Deployer un code dont le
    // schema n'a pas suivi est exactement la panne qu'on corrige.
    const args = etape("migration-schema-prod")?.args ?? [];
    expect(args[0]).toMatch(/-[a-z]*e[a-z]*$/);
  });
});
