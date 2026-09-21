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
