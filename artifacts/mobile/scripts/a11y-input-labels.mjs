#!/usr/bin/env node
/**
 * Verifie que chaque champ de saisie de l'application mobile porte un
 * `accessibilityLabel`.
 *
 * Pourquoi ce script existe. Sur mobile, un `placeholder` n'est pas un nom:
 * VoiceOver et TalkBack annoncent le champ « champ de texte », sans dire
 * lequel, et le placeholder disparait des que l'utilisateur tape. Mesure du
 * 2026-09-04, avant correction: **75 champs, zero `accessibilityLabel`** —
 * l'application etait donc integralement inutilisable au lecteur d'ecran,
 * sans qu'aucun ecran n'ait l'air casse. L'European Accessibility Act rend
 * cette conformite obligatoire, et les magasins d'applications la controlent.
 *
 * Ce qu'il sait faire, et ses limites assumees. Il lit le texte, pas un arbre
 * syntaxique. Un champ compte comme nomme quand il porte `accessibilityLabel`
 * ou `aria-label`. Le sens inverse n'est pas verifie: un libelle vide ou
 * absurde passerait.
 *
 * Usage:
 *   node scripts/a11y-input-labels.mjs           # rapport
 *   node scripts/a11y-input-labels.mjs --check   # sort en 1 au-dessus du plafond
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");

/** Plafond courant. Il ne doit jamais remonter. */
const MAX_UNLABELLED = 0;

/** Dossiers sans code source a verifier (sorties de build, dependances). */
const SKIP_DIRS = new Set(["node_modules", "static-build", ".expo", "dist", "android", "ios"]);

/**
 * Rend la liste d'attributs d'une balise ouverte a `start`.
 *
 * Surtout pas `[^>]*`: une fonction flechee (`onChangeText={v => ...}`)
 * contient un `>` et couperait les attributs en plein milieu — un champ
 * pourtant nomme passerait alors pour anonyme.
 */
function attributesOf(src, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { depth--; continue; }
    if (c === ">" && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

/**
 * `useRef<TextInput>(null)` n'est pas un champ, c'est un parametre de type.
 * En JSX, le `<` est precede d'un espace, d'une parenthese ou d'une accolade;
 * dans un generique, il suit un identifiant. Sans cette distinction, le
 * rapport comptait deux champs qui n'existent pas.
 */
function isTypeArgument(src, index) {
  const prev = src[index - 1];
  return prev !== undefined && /[\w$]/.test(prev);
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export function scan() {
  const findings = [];
  let total = 0;

  for (const file of sourceFiles(ROOT)) {
    const src = fs.readFileSync(file, "utf8");
    for (const match of src.matchAll(/<TextInput\b/g)) {
      if (isTypeArgument(src, match.index)) continue;
      total++;
      const attrs = attributesOf(src, match.index + match[0].length);
      if (/accessibilityLabel=|aria-label=/.test(attrs)) continue;
      findings.push({
        file: path.relative(ROOT, file).split(path.sep).join("/"),
        line: src.slice(0, match.index).split("\n").length,
      });
    }
  }

  return { total, findings };
}

const { total, findings } = scan();
const check = process.argv.includes("--check");

console.log(`champs de saisie: ${total}`);
console.log(`sans nom accessible: ${findings.length} (plafond: ${MAX_UNLABELLED})`);

if (!check) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
  for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(3)}  ${file}`);
  }
}

if (check && findings.length > MAX_UNLABELLED) {
  console.error(
    `\nERREUR: ${findings.length - MAX_UNLABELLED} champ(s) sans accessibilityLabel.\n` +
    "Un `placeholder` ne suffit pas: le lecteur d'ecran annonce alors un champ sans nom,\n" +
    "et le texte disparait des que l'utilisateur tape.\n",
  );
  for (const f of findings.slice(0, 20)) console.error(`  ${f.file}:${f.line}`);
  process.exit(1);
}
