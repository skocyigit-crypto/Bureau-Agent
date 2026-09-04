#!/usr/bin/env node
/**
 * Verifie la taille des zones tactiles.
 *
 * Seuil applique: 24x24 px, le critere 2.5.8 du WCAG 2.2 niveau AA — celui que
 * l'European Accessibility Act rend obligatoire. Les plateformes recommandent
 * davantage (44 pt sur iOS, 48 dp sur Android); ces cas-la sont COMPTES et
 * affiches, mais ne font pas echouer le build: une recommandation n'est pas
 * une obligation, et les confondre rendrait le chiffre inutilisable.
 *
 * Mesure du premier passage (2026-09-04): 512 zones tactiles, **aucune** sous
 * 24 px, 22 entre 24 et 44. Ce script ne corrige donc rien: il empeche que
 * cela se degrade.
 *
 * Pourquoi les 22 n'ont pas ete elargies d'office. `hitSlop` etend la zone
 * au-dela du visuel, sans rien changer a l'ecran — mais trois boutons de 34 px
 * espaces de 6 px qui gagnent 5 px de chaque cote finissent par se chevaucher,
 * et une touche atterrit alors sur le mauvais bouton. C'est pire que le defaut
 * qu'on corrige, et aucune lecture statique ne sait mesurer cet espacement.
 * Ces cas demandent donc un oeil, ecran par ecran.
 *
 * Limites assumees: seules les tailles ECRITES sont vues (StyleSheet du meme
 * fichier, ou style en ligne). Une zone dimensionnee par son contenu, par un
 * `flex`, ou par un style importe d'ailleurs n'est pas mesurable ici — et
 * n'est pas comptee comme conforme pour autant: elle n'est simplement pas vue.
 *
 * Usage:
 *   node scripts/a11y-tap-targets.mjs           # rapport
 *   node scripts/a11y-tap-targets.mjs --check   # sort en 1 sous le seuil AA
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

/** WCAG 2.2 AA, critere 2.5.8. */
const MIN_AA = 24;
/** Recommandation des plateformes (iOS 44 pt / Android 48 dp). */
const PLATFORM_GUIDE = 44;

const SKIP_DIRS = new Set(["node_modules", "static-build", ".expo", "dist", "android", "ios"]);
const TOUCHABLES = /<(Pressable|TouchableOpacity|TouchableHighlight)\b/g;

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Fin d'attributs par comptage d'accolades: `onPress={() => ...}` contient un `>`. */
function attributesOf(src, start) {
  let depth = 0, quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

/** Entrees de style du fichier qui fixent une largeur ou une hauteur. */
function declaredSizes(src) {
  const sizes = new Map();
  for (const m of src.matchAll(/(\w+)\s*:\s*\{([^{}]*)\}/g)) {
    const width = /\bwidth:\s*(\d+)/.exec(m[2])?.[1];
    const height = /\bheight:\s*(\d+)/.exec(m[2])?.[1];
    if (width || height) sizes.set(m[1], { w: width ? +width : null, h: height ? +height : null });
  }
  return sizes;
}

export function scan() {
  let total = 0;
  const belowAA = [];
  const belowGuide = [];

  for (const file of sourceFiles(ROOT)) {
    const src = fs.readFileSync(file, "utf8");
    const sizes = declaredSizes(src);

    for (const m of src.matchAll(TOUCHABLES)) {
      const attrs = attributesOf(src, m.index + m[0].length);
      total++;
      // `hitSlop` etend la zone reelle au-dela du visuel: la taille ecrite ne
      // dit alors plus ce qui est touchable.
      if (/hitSlop/.test(attrs)) continue;

      let w = null, h = null;
      for (const key of [...attrs.matchAll(/styles\.(\w+)/g)].map((x) => x[1])) {
        const v = sizes.get(key);
        if (!v) continue;
        if (v.w != null) w = v.w;
        if (v.h != null) h = v.h;
      }
      const inlineW = /\bwidth:\s*(\d+)/.exec(attrs)?.[1];
      const inlineH = /\bheight:\s*(\d+)/.exec(attrs)?.[1];
      if (inlineW) w = +inlineW;
      if (inlineH) h = +inlineH;
      if (w == null && h == null) continue;

      const smallest = Math.min(w ?? Infinity, h ?? Infinity);
      const record = {
        where: `${path.relative(ROOT, file).split(path.sep).join("/")}:${src.slice(0, m.index).split("\n").length}`,
        w, h,
      };
      if (smallest < MIN_AA) belowAA.push(record);
      else if (smallest < PLATFORM_GUIDE) belowGuide.push(record);
    }
  }

  return { total, belowAA, belowGuide };
}

const { total, belowAA, belowGuide } = scan();

console.log(`zones tactiles avec une taille ecrite: ${total}`);
console.log(`sous ${MIN_AA}px (WCAG 2.2 AA): ${belowAA.length}`);
console.log(`entre ${MIN_AA} et ${PLATFORM_GUIDE}px (recommandation des plateformes, non bloquant): ${belowGuide.length}`);

if (!process.argv.includes("--check")) {
  for (const r of belowAA) console.log(`  AA  ${r.where}  w=${r.w ?? "?"} h=${r.h ?? "?"}`);
  for (const r of belowGuide.slice(0, 25)) console.log(`  ..  ${r.where}  w=${r.w ?? "?"} h=${r.h ?? "?"}`);
}

if (process.argv.includes("--check") && belowAA.length > 0) {
  console.error(`\nERREUR: ${belowAA.length} zone(s) tactile(s) sous ${MIN_AA}x${MIN_AA}px.\n`);
  for (const r of belowAA) console.error(`  ${r.where}  w=${r.w ?? "?"} h=${r.h ?? "?"}`);
  console.error("\nAgrandissez la zone, ou ajoutez un `hitSlop` — en verifiant que la zone\n" +
    "elargie ne chevauche pas celle du voisin, sinon la touche atterrit a cote.\n");
  process.exit(1);
}
