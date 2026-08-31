import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Une alerte ne doit affirmer que ce qu'elle a verifie.
 *
 * Le moniteur previent l'administrateur quand des donnees personnelles sont
 * presentes sans sauvegarde Google Drive. Le predicat qui declenchait ce
 * message s'ecrivait:
 *
 *     rgpdTables.some(t => { return true; })
 *
 * Il ignorait `t` et renvoyait toujours vrai. Le message « Donnees
 * personnelles detectees (contacts, appels, messages) » partait donc pour
 * toute organisation ayant la moindre ligne, meme quand ces quatre tables
 * etaient vides — un constat annonce sans qu'aucune detection ait eu lieu.
 *
 * Ce n'est pas une faute benigne: une alerte qui se declenche sans motif
 * apprend a l'operateur a les ignorer toutes, y compris celles qui signalent
 * une vraie absence de sauvegarde.
 */

const source = readFileSync(
  join(import.meta.dirname, "..", "services", "data-protection-monitor.ts"),
  "utf8",
);

describe("detection de donnees personnelles", () => {
  it("s'appuie sur le compte reel des tables", () => {
    expect(source).toMatch(/rgpdTables\.some\(\(t\) => \(tableCounts\[t\] \?\? 0\) > 0\)/);
  });

  it("recoit les comptes par table, pas seulement le total", () => {
    // Le total ne permet pas de savoir SI ces tables-la sont peuplees: c'est
    // ce qui rendait la verification impossible et le predicat creux.
    expect(source).toMatch(/tableCounts: Record<string, number>/);
    expect(source).toMatch(/analyzeOrgBackupStatus\(org,[^)]*tableCounts\)/);
  });

  it("n'a plus de predicat toujours vrai", () => {
    // Forme generique: un callback qui renvoie une constante ignore son
    // parametre et ne verifie rien.
    //
    // Les commentaires sont retires d'abord: celui du fichier cite l'ancien
    // predicat en toutes lettres pour expliquer la regression, et le compter
    // comme du code ferait echouer ce test sur sa propre documentation.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\.some\(\s*\(?\w*\)?\s*=>\s*\{?\s*return true;?\s*\}?\s*\)/);
    expect(code).not.toMatch(/\.every\(\s*\(?\w*\)?\s*=>\s*\{?\s*return true;?\s*\}?\s*\)/);
  });

  it("garde les quatre tables porteuses de donnees personnelles", () => {
    const list = source.match(/const rgpdTables = \[([^\]]*)\]/);
    expect(list).not.toBeNull();
    const tables = [...list![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(tables).toEqual(["calls", "contacts", "messages", "prospects"]);
  });

  it("compte bien ces tables", () => {
    // Si une table listee ici n'etait pas comptee, son compte serait
    // absent et la detection la manquerait en silence.
    const counted = source.slice(source.indexOf("const tables = ["), source.indexOf("const counts"));
    for (const t of ["contacts", "calls", "messages", "prospects"]) {
      expect(counted, `table non comptee: ${t}`).toContain(`"${t}"`);
    }
  });
});
