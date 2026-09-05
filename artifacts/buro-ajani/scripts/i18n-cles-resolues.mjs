#!/usr/bin/env node
/**
 * i18n-cles-resolues.mjs — toute cle t("...") ecrite en dur doit exister,
 * et resoudre vers du TEXTE.
 *
 * Le controle d'accessibilite verifiait qu'un `aria-label` EXISTE. Il ne
 * verifiait pas que sa cle de traduction resout: trois commandes portaient un
 * nom accessible qui affichait la cle brute — un lecteur d'ecran annoncait
 * « settingsSecurite.account.totpLabel » au lieu de « Code de verification ».
 * Une etiquette presente mais illisible passe toutes les portes existantes.
 *
 * Deuxieme piege, decouvert en corrigeant le premier: une cle peut exister et
 * pointer vers un OBJET. `commandantIa.tasks.type` porte les quatre libelles
 * d'une liste deroulante; l'`aria-label` appelait ce meme chemin et recevait
 * donc un objet. En « corrigeant » naivement — en remplacant l'objet par une
 * chaine — on cassait les quatre libelles qui, eux, fonctionnaient. D'ou la
 * verification du TYPE et pas seulement de la presence.
 *
 * Ce que ce script ne peut pas verifier: les cles construites
 * (`t("prefixe." + valeur)`, gabarits). Elles sont exclues explicitement — les
 * signaler produirait du bruit qui ferait ignorer le vrai signal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const argSrc = process.argv.find((a) => a.startsWith("--src="));
const argLoc = process.argv.find((a) => a.startsWith("--locales="));
const SRC = argSrc ? path.resolve(process.cwd(), argSrc.slice(6)) : path.join(ici, "..", "src");
const LOCALES = argLoc
  ? path.resolve(process.cwd(), argLoc.slice(10))
  : path.join(ici, "..", "src", "i18n", "locales");

const check = process.argv.includes("--check");

/** Chemins qui menent a une chaine, et chemins qui menent a un objet. */
function indexer(obj, prefixe = "", chaines = new Set(), objets = new Set()) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const cle = prefixe ? `${prefixe}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      objets.add(cle);
      indexer(v, cle, chaines, objets);
    } else {
      chaines.add(cle);
    }
  }
  return { chaines, objets };
}

function sources(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) acc.push(p);
  }
  return acc;
}

/**
 * Retire commentaires de bloc et de ligne: un commentaire n'affiche rien.
 *
 * `[^\n\r]*` et NON `.*$`. En JavaScript, `.` ne franchit pas un terminateur
 * de ligne, et `\r` en est un: sur un fichier a fins de ligne Windows, `.*$`
 * ne pouvait pas atteindre la fin de la chaine, donc `//...` n'etait JAMAIS
 * retire. Le premier jet de ce script signalait ainsi une cle qui vivait dans
 * un commentaire — un faux positif qui, repete, apprend a ignorer la sortie.
 */
function code(src) {
  return src
    .replace(/\/\*[^]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/[^\n\r]*/, ""))
    .join("\n");
}

const ref = JSON.parse(fs.readFileSync(path.join(LOCALES, "fr.json"), "utf8"));
const { chaines, objets } = indexer(ref);

const absentes = [];
const versObjet = [];
let vues = 0;

for (const f of sources(SRC)) {
  code(fs.readFileSync(f, "utf8"))
    .split("\n")
    .forEach((ligne, i) => {
      // Guillemets simples/doubles suivis de `)` ou `,`: cela exclut les cles
      // construites par concatenation ou par gabarit.
      for (const m of ligne.matchAll(/\bt\(\s*(["'])([A-Za-z0-9_.]+)\1\s*[),]/g)) {
        vues += 1;
        const cle = m[2];
        const ou = `${path.relative(process.cwd(), f).split(path.sep).join("/")}:${i + 1}`;
        if (objets.has(cle)) versObjet.push(`${ou}  ${cle}`);
        else if (!chaines.has(cle)) absentes.push(`${ou}  ${cle}`);
      }
    });
}

console.log(`cles statiques rencontrees: ${vues}`);
console.log(`absentes de fr.json: ${absentes.length}`);
console.log(`resolvant vers un objet: ${versObjet.length}`);
for (const l of [...absentes, ...versObjet].slice(0, 40)) console.log("  " + l);

if (check && (absentes.length > 0 || versObjet.length > 0)) {
  console.error(
    "\nERREUR: une cle de traduction ne resout pas vers du texte.\n" +
    "L'interface affichera la cle brute — et un lecteur d'ecran l'annoncera telle quelle.\n" +
    "Si la cle pointe vers un objet, ajoutez une cle SOEUR pour le libelle plutot que\n" +
    "de remplacer l'objet: il porte probablement les libelles de plusieurs options.\n",
  );
  process.exit(1);
}
