/**
 * Le kit de conformite remis aux employeurs affirme des garanties.
 * Ce test les relie au code : si le code change, la promesse ecrite tombe avec.
 * (Une promesse sans mecanisme est le defaut le plus frequent de ce depot.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const lire = (...p: string[]) => readFileSync(join(RACINE, ...p), "utf8");
const DOSSIER_KIT = ["artifacts", "tanitim", "src", "content", "conformite-employeur"] as const;
const KIT = lire(...DOSSIER_KIT, "README.md");
const SRC = (...p: string[]) => lire("artifacts", "api-server", "src", ...p);

describe("chaque garantie annoncee a son mecanisme", () => {
  it("« ses propres pointages » : portee personnelle appliquee aux routes", () => {
    expect(KIT).toContain("que ses propres pointages");
    expect(SRC("services", "portee-pointage.ts")).toContain('export const ROLES_RESPONSABLES = new Set(["administrateur", "super_admin"])');
    expect(SRC("routes", "checkins.ts")).toContain("conditionPortee(porteePointage(req.session))");
  });
  it("« aucune coordonnee GPS n'est conservee » : ecriture a null", () => {
    expect(KIT).toContain("Aucune coordonnée GPS n'est conservée");
    expect(SRC("routes", "locations.ts")).toContain("lat: null, lng: null, accuracyM: null, at,");
  });
  it("« 30 jours » : constante de purge", () => {
    expect(KIT).toContain("30 jours, purge automatique");
    expect(SRC("services", "location-cleanup-cron.ts")).toContain("export const RETENTION_DAYS = 30;");
  });
  it("« pseudonymisees avant envoi a l'IA »", () => {
    expect(KIT).toContain("**pseudonymisées**");
    expect(SRC("services", "performance-analyzer.ts")).toContain("const metricsJSON = JSON.stringify(donnees, null, 2);");
  });
  it("« traces dans le journal d'audit »", () => {
    expect(KIT).toContain("tracés dans le journal d'audit");
    expect(SRC("routes", "performance.ts")).toContain('"performance_report_generated"');
  });
  it("« reconnaissance faciale desactivee » : routeur non monte", () => {
    expect(KIT).toContain("La reconnaissance faciale est **désactivée**");
    expect(SRC("routes", "index.ts")).toContain('// router.use("/face", faceRecognitionRouter);');
  });
  it("les liens internes du kit existent", () => {
    for (const f of ["dossier-consultation-cse.md", "note-information-salaries.md", "trame-aipd.md"]) {
      expect(KIT).toContain(`](${f})`);
      expect(() => lire(...DOSSIER_KIT, f)).not.toThrow();
    }
  });
  it("la note ne promet pas de purge des pointages que le logiciel ne fait pas", () => {
    expect(KIT).toContain("Aucune purge automatique");
  });
});

/**
 * Relecture du 21/09/2026 contre les sources officielles et le code.
 * Chaque cas ci-dessous etait faux ou absent dans le kit publie.
 */
describe("le kit dit ce que le code et le droit disent", () => {
  const NOTE = lire(...DOSSIER_KIT, "note-information-salaries.md");
  const CSE = lire(...DOSSIER_KIT, "dossier-consultation-cse.md");
  const AIPD = lire(...DOSSIER_KIT, "trame-aipd.md");
  const TOUT = [KIT, NOTE, CSE, AIPD].join("\n");

  it("la pseudonymisation promise est tenue par les TROIS surfaces qui l'oubliaient", () => {
    // Le kit la promettait; trois routes envoyaient pourtant nom et prenom.
    // (Le comportement est prouve par evaluation-sans-identite-chez-l-ia.)
    for (const f of ["workforce-agent.ts", "workforce-intelligence.ts", "ai-commandant.ts"]) {
      expect(SRC("routes", f), `${f} n'emploie pas de pseudonyme`).toMatch(/pseudonyme\(i \+ 1\)/);
      expect(SRC("routes", f), `${f} ne remet pas les noms`).toContain("reidentifierNoms(");
    }
  });

  it("le transfert hors UE vers les fournisseurs d'IA est dit aux salaries", () => {
    // RGPD art. 13.1.f; la politique de confidentialite le disait deja.
    expect(NOTE).toMatch(/États-Unis/);
    expect(NOTE).toMatch(/clauses contractuelles types/);
    expect(CSE).toMatch(/États-Unis/);
  });

  it("l'AIPD est dite obligatoire pour les rapports d'evaluation", () => {
    // Deliberation CNIL n° 2018-327: les profils a des fins RH sont sur la
    // liste; la regle des deux criteres ne s'applique qu'hors liste.
    expect(AIPD).toMatch(/2018-327/);
    expect(AIPD).toMatch(/AIPD requise/);
    expect(AIPD).not.toMatch(/l'AIPD est recommandée, et requise\s+lorsque deux critères/);
  });

  it("la presence sur zone decrit l'historique horodate que le code conserve", () => {
    // routes/locations.ts ecrit un evenement par releve (« ping » a defaut
    // d'entree ou de sortie): pas seulement « l'heure du dernier releve ».
    expect(SRC("routes", "locations.ts")).toMatch(/event: "ping"/);
    for (const doc of [KIT, NOTE, CSE]) expect(doc).toMatch(/horodat/);
    expect(TOUT).not.toMatch(/heure du dernier relevé, (niveau de )?batterie/);
  });

  it("la limite des pauses est avouee tant que l'application ne sait pas suspendre", () => {
    expect(KIT).toMatch(/ne permet \*\*pas\*\* au salarié de suspendre/);
    expect(NOTE).toMatch(/Pauses/);
  });

  it("aucune duree de conservation inventee", () => {
    // « 5 ans » n'etait rattache a aucun texte.
    expect(TOUT).not.toMatch(/par exemple 5 ans|indique 5 ans/);
    expect(TOUT).toMatch(/D3171-16/);
  });

  it("les salaries savent que les rapports viennent d'une IA", () => {
    expect(NOTE).toMatch(/produits par un système d'intelligence artificielle/);
  });

  it("le reglement europeen sur l'IA est mentionne pour l'employeur", () => {
    expect(KIT).toMatch(/annexe III, point 4 b/);
    expect(KIT).toMatch(/article 26/);
  });
});
