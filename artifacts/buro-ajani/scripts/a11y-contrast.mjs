#!/usr/bin/env node
/**
 * Verifie le contraste des couples texte/fond definis par le theme.
 *
 * Pourquoi ce script existe. Le contraste est la seule regle
 * d'accessibilite entierement decidable a partir du code: les couleurs sont
 * des variables CSS, et le rapport de contraste est une formule. Il n'y a
 * donc aucune raison de le decouvrir en production.
 *
 * Ce qu'il a trouve au premier passage (2026-09-04), en theme clair:
 *  - `destructive-foreground` sur `destructive` a **3.59** — le texte du
 *    bouton de suppression. C'est-a-dire l'action la plus irreversible de
 *    l'application, ecrite dans la teinte la moins lisible;
 *  - `muted-foreground` sur `muted` a **4.34** — tout le texte secondaire.
 *
 * Les deux passaient inapercus parce qu'un contraste insuffisant ne casse
 * rien: la page s'affiche, elle est juste illisible pour une partie des
 * utilisateurs (et sous un ecran en plein soleil, pour tout le monde).
 *
 * Seuil: 4.5:1, le niveau AA du WCAG 2.2 pour du texte normal — celui que
 * l'European Accessibility Act rend obligatoire. Les couples sont ceux que le
 * theme declare explicitement; ce script ne voit PAS les couleurs ecrites en
 * dur dans un composant (`text-red-400`, `#6366f1`), qui restent a verifier
 * a la main.
 *
 * Usage:
 *   node scripts/a11y-contrast.mjs           # rapport
 *   node scripts/a11y-contrast.mjs --check   # sort en 1 si un couple echoue
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(here, "..", "src", "index.css");

/** Niveau AA du WCAG 2.2 pour du texte de taille normale. */
const MIN_RATIO = 4.5;

/**
 * Couples texte/fond declares par le theme. Un couple absent du fichier fait
 * echouer le script: une variable renommee ne doit pas faire disparaitre
 * silencieusement sa verification.
 */
const PAIRS = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-primary-foreground", "sidebar-primary"],
  ["sidebar-accent-foreground", "sidebar-accent"],
];

const THEMES = [["clair", ":root"], ["sombre", ".dark"]];

function variablesOf(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`bloc ${selector} introuvable dans index.css`);
  const end = css.indexOf("\n}", start);
  const vars = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

/** `H S% L%` (la forme utilisee par le theme) vers RGB 0..1. */
function hslToRgb(value) {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value ?? "");
  if (!m) return null;
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

function relativeLuminance([r, g, b]) {
  const lin = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const css = fs.readFileSync(CSS, "utf8");
const failures = [];

for (const [themeName, selector] of THEMES) {
  const vars = variablesOf(css, selector);
  console.log(`\n== theme ${themeName} ==`);
  for (const [fgName, bgName] of PAIRS) {
    const fg = hslToRgb(vars[fgName]);
    const bg = hslToRgb(vars[bgName]);
    if (!fg || !bg) {
      // Variable absente ou dans un format inattendu: on ne conclut pas
      // « conforme » sur une valeur qu'on n'a pas su lire.
      failures.push(`${themeName}: ${fgName} / ${bgName} — valeur illisible (${vars[fgName]} / ${vars[bgName]})`);
      console.log(`  ??  ${fgName} / ${bgName}`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    const ok = ratio >= MIN_RATIO;
    if (!ok) failures.push(`${themeName}: ${fgName} / ${bgName} — ${ratio.toFixed(2)} (minimum ${MIN_RATIO})`);
    console.log(`  ${ok ? "ok " : "NON"} ${ratio.toFixed(2)}  ${fgName} / ${bgName}`);
  }
}

if (process.argv.includes("--check") && failures.length > 0) {
  console.error(`\nERREUR: ${failures.length} couple(s) sous ${MIN_RATIO}:1 (WCAG 2.2 AA).\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error("\nAjustez la clarte (L%) du jeton dans src/index.css, pas le composant:\n" +
    "une correction locale laisserait le meme defaut partout ailleurs.\n");
  process.exit(1);
}
