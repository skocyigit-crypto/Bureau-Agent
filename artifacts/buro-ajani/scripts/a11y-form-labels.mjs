#!/usr/bin/env node
/**
 * Verifie que chaque champ de formulaire porte un nom accessible.
 *
 * Pourquoi ce script existe. Un champ dont le seul libelle est un
 * `placeholder` n'a pas de nom accessible: le texte disparait des que
 * l'utilisateur tape, et un lecteur d'ecran n'a plus rien a annoncer.
 * L'European Accessibility Act rend cette conformite obligatoire pour un
 * produit vendu en Europe, et c'est le type de defaut qui ne se voit jamais a
 * l'ecran — la page est belle, elle est simplement inutilisable au clavier et
 * au lecteur d'ecran.
 *
 * Ce qu'il sait faire, et ses limites assumees. Il lit le texte, pas un arbre
 * syntaxique. Un champ est compte comme NOMME quand il porte `aria-label` /
 * `aria-labelledby`, quand son `id` est cible par un `htmlFor` du meme
 * fichier, quand il est enveloppe par un `<Label>` ouvert juste avant, ou
 * quand il est rendu dans un `<FormControl>` (le composant de formulaire
 * cable lui-meme l'association). Tout le reste est signale. Le sens inverse
 * n'est pas verifie: un `aria-label` vide ou absurde passerait.
 *
 * Pourquoi un cliquet plutot qu'un seuil a zero. La dette mesuree au premier
 * passage est reelle et se compte en centaines: la ramener a zero d'un coup
 * serait une revue impossible a relire. Le cliquet donne ce qui compte tout
 * de suite — elle ne peut plus grandir — et chaque correction abaisse le
 * plafond. Un chiffre qui ne baisse jamais reste un mensonge poli; celui-ci
 * est verifie a chaque build.
 *
 * Usage:
 *   node scripts/a11y-form-labels.mjs           # rapport
 *   node scripts/a11y-form-labels.mjs --check   # sort en 1 au-dessus du plafond
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");

/**
 * Plafond courant. Il ne doit JAMAIS remonter: une PR qui ajoute un champ sans
 * libelle fait echouer le build. Baisser ce nombre en meme temps qu'on corrige
 * des champs fait partie de la correction.
 */
const MAX_UNLABELLED = 178;

/** Balises rendant un champ de saisie. */
const CONTROL = /<(Input|Textarea|SelectTrigger)\b/g;

/**
 * Rend la liste d'attributs d'une balise ouverte a `start`.
 *
 * Surtout PAS `[^>]*`: une fonction flechee (`onChange={e => ...}`) contient
 * un `>` et couperait les attributs en plein milieu — le lecteur croirait
 * alors qu'un champ n'a pas d'`aria-label` alors qu'il en a un plus bas. On
 * avance donc en comptant les accolades et en ignorant ce qui est entre
 * guillemets, comme le fait deja `tenant-scope-check.mjs` pour les corps de
 * table.
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
/** Fenetre remontee pour detecter un `<Label>` ou `<FormControl>` englobant. */
const LOOKBEHIND = 600;

function tsxFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

export function scan() {
  const findings = [];
  let total = 0;

  for (const file of tsxFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    const htmlFors = new Set(
      [...src.matchAll(/htmlFor=\{?["'`]?([\w.$-]+)/g)].map((m) => m[1]),
    );

    for (const match of src.matchAll(CONTROL)) {
      total++;
      const attrs = attributesOf(src, match.index + match[0].length);
      const id = attrs.match(/\bid=\{?["'`]?([\w.$-]+)/)?.[1];
      const hasAria = /aria-label(ledby)?=/.test(attrs);
      const linkedById = Boolean(id && htmlFors.has(id));

      // Enveloppe implicite: un `<Label>` (ou `<FormControl>`) ouvert juste
      // avant, sans balise fermante entre les deux.
      const before = src.slice(Math.max(0, match.index - LOOKBEHIND), match.index);
      const wrapped = ["Label", "FormControl"].some((tag) => {
        const open = before.lastIndexOf(`<${tag}`);
        return open !== -1 && open > before.lastIndexOf(`</${tag}>`);
      });

      if (hasAria || linkedById || wrapped) continue;

      const line = src.slice(0, match.index).split("\n").length;
      findings.push({
        file: path.relative(path.join(here, "..", "..", ".."), file).replace(/\\/g, "/"),
        line,
        tag: match[1],
      });
    }
  }

  return { total, findings };
}

const { total, findings } = scan();
const check = process.argv.includes("--check");

console.log(`champs de formulaire: ${total}`);
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
    `\nERREUR: ${findings.length - MAX_UNLABELLED} champ(s) sans nom accessible en plus du plafond.\n` +
    "Donnez au champ un `aria-label`, ou un `<Label htmlFor>` qui cible son `id`.\n" +
    "Un `placeholder` ne suffit pas: il disparait des que l'utilisateur tape.\n",
  );
  for (const f of findings.slice(0, 20)) console.error(`  ${f.file}:${f.line} <${f.tag}>`);
  process.exit(1);
}

if (check && findings.length < MAX_UNLABELLED) {
  console.log(
    `\nLe plafond peut descendre a ${findings.length} ` +
    "(MAX_UNLABELLED dans scripts/a11y-form-labels.mjs).",
  );
}
