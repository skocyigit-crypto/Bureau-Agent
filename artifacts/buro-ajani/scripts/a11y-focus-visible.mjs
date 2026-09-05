#!/usr/bin/env node
/**
 * Verifie qu'aucun element ne supprime son contour de focus sans le remplacer.
 *
 * Le critere: WCAG 2.2 AA 2.4.7 « Focus Visible ». Un utilisateur au clavier
 * doit voir OU il se trouve. `outline-none` retire l'indicateur que le
 * navigateur fournit gratuitement; c'est legitime — mais seulement si quelque
 * chose le remplace.
 *
 * Ce que ce script a appris a NE PAS signaler. Un premier jet cherchait un
 * anneau (`focus-visible:ring`) et rapportait 9 defauts. Sept etaient faux:
 * les elements de menu montrent leur focus par un fond (`focus:bg-accent`),
 * les champs par une bordure (`focus:border-...`). Un indicateur visible n'est
 * pas forcement un anneau. Le script accepte donc toute reprise visible au
 * focus — anneau, contour, bordure, fond, ou l'attribut `data-[highlighted]`
 * que produit Radix.
 *
 * Restaient deux vrais defauts, corriges: le bouton du compte (workspace-user)
 * et le declencheur de statut dans la liste des taches n'avaient AUCUN style de
 * focus. Au clavier, la tabulation s'y arretait sans que rien ne bouge.
 *
 * Limites assumees: seules les classes ecrites dans la meme chaine sont vues.
 * Un focus rendu visible par une regle CSS globale ou par un composant parent
 * echappe a cette lecture — ce serait alors un faux positif, a lever en
 * ajoutant la classe explicitement (ce qui documente l'intention) plutot qu'en
 * elargissant ce script.
 *
 * Usage:
 *   node scripts/a11y-focus-visible.mjs           # rapport
 *   node scripts/a11y-focus-visible.mjs --check   # sort en 1 s'il en reste
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Dossier analyse. Surchargeable par `--src=<chemin>` pour pointer une AUTRE
// application: la declaration d'accessibilite reconnaissait que « les pages du
// site public ne sont pas couvertes par cette verification ». Un controle qui
// ne regarde qu'une des deux interfaces laisse l'autre deriver sans que rien
// ne le signale.
const argSrc = process.argv.find((a) => a.startsWith("--src="));
const SRC = argSrc
  ? path.resolve(process.cwd(), argSrc.slice("--src=".length))
  : path.join(here, "..", "src");

/** Aucun element ne doit rester sans indicateur. */
const MAX_WITHOUT_INDICATOR = 0;

/** Retire l'indicateur du navigateur. */
const REMOVES_OUTLINE = /(?:^|\s)(?:focus:|focus-visible:)?outline-none(?=\s|$)/;

/**
 * Reprend un indicateur visible au focus. Volontairement large: un fond ou une
 * bordure qui change au focus se voit tout aussi bien qu'un anneau.
 */
const RESTORES_INDICATOR = /(?:focus|focus-visible):(?:ring|outline|border|bg|text|shadow)|ring-offset|data-\[highlighted\]|data-\[state=open\]:bg/;

const LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

function tsxFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export function scan() {
  let removals = 0;
  const bare = [];
  for (const file of tsxFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(LITERAL)) {
      const cls = m[1] ?? m[2] ?? m[3] ?? "";
      if (!REMOVES_OUTLINE.test(cls)) continue;
      removals++;
      if (RESTORES_INDICATOR.test(cls)) continue;
      bare.push({
        where: `${path.relative(path.join(here, ".."), file).split(path.sep).join("/")}:${src.slice(0, m.index).split("\n").length}`,
        cls: cls.slice(0, 100),
      });
    }
  }
  return { removals, bare };
}

const { removals, bare } = scan();

console.log(`elements retirant le contour de focus: ${removals}`);
console.log(`sans indicateur de remplacement: ${bare.length} (plafond: ${MAX_WITHOUT_INDICATOR})`);

if (!process.argv.includes("--check")) {
  for (const b of bare) console.log(`  ${b.where}  ${b.cls}`);
}

if (process.argv.includes("--check") && bare.length > MAX_WITHOUT_INDICATOR) {
  console.error(`\nERREUR: ${bare.length} element(s) sans indicateur de focus visible (WCAG 2.2 AA 2.4.7).\n`);
  for (const b of bare) console.error(`  ${b.where}\n    ${b.cls}`);
  console.error("\nAjoutez une reprise visible au focus — par exemple\n" +
    "`focus-visible:ring-1 focus-visible:ring-ring`, ou un fond/bordure au focus.\n");
  process.exit(1);
}
