/**
 * Une adresse d'API qui commence par `//` ne designe pas un chemin.
 *
 * `BASE_URL` vaut « / » en production. Ecrire `` `${base}/api/x` `` sans avoir
 * retire le slash final produit donc `//api/x` — et un navigateur lit une
 * adresse commencant par deux slashs comme PROTOCOLE-RELATIVE: il appelle
 * `https://api/x`, c'est-a-dire un hote nomme « api » qui n'existe pas.
 *
 * Le defaut ne leve aucune erreur visible: l'appel part, echoue, et la
 * fonctionnalite ne rend simplement rien. Il a ete trouve le 2026-09-11 non
 * pas par un test mais par les RAPPORTS DE VIOLATION CSP de la production, qui
 * signalaient `connect-src` bloquant `https://api/ai/central-intelligence`
 * depuis `app.agentdebureau.fr`. Deux composants etaient touches:
 * `central-intelligence` et `ai-discovery-panel` — deux panneaux du tableau de
 * bord qui ne fonctionnaient donc pas en ligne.
 *
 * Ce test interdit la forme, pas le symptome: la CSP a fait office d'alarme
 * une fois, mais elle n'est pas un test, et elle ne parle que de ce qui est
 * deja parti en production.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSources(chemin));
    } else if (/\.tsx?$/.test(entree) && !entree.includes(".test.")) {
      trouves.push(chemin);
    }
  }
  return trouves;
}

/**
 * Les bases tirees de `BASE_URL` SANS retrait du slash final, dans un fichier.
 *
 * On ne regarde que les declarations: une base correctement rognee
 * (`.replace(/\/$/, "")`) ou normalisee avec un slash final explicite
 * (`.replace(/\/?$/, "/")`) est hors sujet.
 */
function basesNonRognees(source: string): string[] {
  return [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\(?\s*import\.meta\.env\.BASE_URL[^;]*;/g)]
    .filter((m) => !m[0].includes("replace("))
    .map((m) => m[1]);
}

describe("les adresses d'API ne commencent jamais par deux slashs", () => {
  const fautes: string[] = [];
  const fichiers = fichiersSources(SRC);

  for (const chemin of fichiers) {
    const source = readFileSync(chemin, "utf8");
    for (const base of basesNonRognees(source)) {
      // La faute exacte: une base non rognee suivie d'un slash litteral.
      const motif = new RegExp("\\$\\{" + base + "\\}/", "g");
      const occurrences = [...source.matchAll(motif)].length;
      if (occurrences > 0) {
        fautes.push(`${chemin.slice(SRC.length + 1)} (${base}, ${occurrences}x)`);
      }
    }
  }

  it("inspecte bien des fichiers", () => {
    // Garde-fou: si le parcours ne trouvait aucun fichier, l'assertion
    // suivante comparerait le vide au vide et passerait sans rien lire.
    expect(fichiers.length, "aucun fichier source parcouru").toBeGreaterThan(50);
  });

  it("aucune base non rognee n'est suivie d'un slash", () => {
    expect(
      fautes,
      "ces adresses deviennent `//api/...`, lu comme l'hote `api` par le navigateur",
    ).toEqual([]);
  });
});
