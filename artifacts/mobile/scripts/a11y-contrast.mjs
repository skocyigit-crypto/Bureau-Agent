#!/usr/bin/env node
/**
 * Contraste de la palette de l'application mobile.
 *
 * Le pendant de `a11y-contrast.mjs` cote web. La palette mobile n'avait jamais
 * ete mesuree, et elle allait plus mal:
 *
 *  - `destructiveForeground` sur `destructive` a **3.76 dans LES DEUX themes**
 *    — le texte blanc du bouton de suppression;
 *  - en theme clair, `success` a **2.18**, `warning` a **2.05**, `info` a
 *    **3.52** sur le fond de page. Ces trois-la sont bien utilisees comme
 *    TEXTE (ecran securite), verifie avant de le dire;
 *  - `mutedForeground` sur `muted` a 4.34, le meme defaut que cote web.
 *
 * Une tension reelle, resolue par un jeton de plus. En theme sombre, AUCUN
 * rouge ne peut a la fois porter du texte blanc (il doit etre sombre) et
 * servir de texte sur un fond sombre (il doit etre clair). Un seul jeton ne
 * pouvait pas tenir les deux roles: `destructive` reste la couleur de fond,
 * `destructiveText` est la couleur de texte. Les quatre messages d'erreur qui
 * utilisaient `destructive` comme texte ont ete bascules.
 *
 * Exclusion, avec sa raison: `tint` n'est reference nulle part dans le code
 * (`colors.tint` = 0 occurrence). Le signaler serait du bruit sur un jeton
 * mort. S'il reprend du service, il sortira de cette liste.
 *
 * Usage:
 *   node scripts/a11y-contrast.mjs           # rapport
 *   node scripts/a11y-contrast.mjs --check   # sort en 1 si un couple echoue
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PALETTE = path.join(here, "..", "constants", "colors.ts");

/** WCAG 2.2 AA, texte de taille normale. */
const MIN_RATIO = 4.5;

/**
 * Couples verifies. Un couple dont un membre manque fait ECHOUER le script:
 * un jeton renomme ne doit pas faire disparaitre sa verification en silence.
 */
const PAIRS = [
  ["foreground", "background"],
  ["text", "background"],
  ["mutedForeground", "background"],
  ["mutedForeground", "muted"],
  ["cardForeground", "card"],
  ["primaryForeground", "primary"],
  ["secondaryForeground", "secondary"],
  ["accentForeground", "accent"],
  ["destructiveForeground", "destructive"],
  ["destructiveText", "background"],
  ["destructiveText", "card"],
  ["success", "background"],
  ["warning", "background"],
  ["info", "background"],
];

const src = fs.readFileSync(PALETTE, "utf8");

function themeColors(name) {
  const start = src.indexOf(`${name}: {`);
  if (start === -1) throw new Error(`theme ${name} introuvable`);
  const end = src.indexOf("\n  },", start);
  const out = {};
  for (const m of src.slice(start, end).matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)) out[m[1]] = m[2];
  return out;
}

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const failures = [];
for (const theme of ["light", "dark"]) {
  const colors = themeColors(theme);
  console.log(`\n== theme ${theme} ==`);
  for (const [fg, bg] of PAIRS) {
    if (!colors[fg] || !colors[bg]) {
      failures.push(`${theme}: ${fg} / ${bg} — jeton absent (${colors[fg]} / ${colors[bg]})`);
      console.log(`  ??  ${fg} / ${bg}`);
      continue;
    }
    const ratio = contrast(toRgb(colors[fg]), toRgb(colors[bg]));
    const ok = ratio >= MIN_RATIO;
    if (!ok) failures.push(`${theme}: ${fg} / ${bg} — ${ratio.toFixed(2)} (minimum ${MIN_RATIO})`);
    console.log(`  ${ok ? "ok " : "NON"} ${ratio.toFixed(2)}  ${fg} / ${bg}`);
  }
}

if (process.argv.includes("--check") && failures.length > 0) {
  console.error(`\nERREUR: ${failures.length} couple(s) sous ${MIN_RATIO}:1 (WCAG 2.2 AA).\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error("\nCorrigez le JETON dans constants/colors.ts, pas l'ecran:\n" +
    "une retouche locale laisserait le meme defaut partout ailleurs.\n");
  process.exit(1);
}
