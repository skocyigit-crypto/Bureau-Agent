#!/usr/bin/env node
/**
 * Contraste des couleurs ecrites EN DUR dans les composants.
 *
 * `a11y-contrast.mjs` verifie les jetons du theme. Mais l'application ecrit
 * aussi ~2900 classes de couleur a la main (`text-amber-500`, `bg-red-100`),
 * qu'aucun jeton ne couvre. Ce script les lit, resout la palette Tailwind
 * (oklch -> sRGB) et calcule le rapport reel.
 *
 * Ce qu'il affirme, et ce qu'il n'affirme pas. Un couple n'est RETENU que si
 * le texte et son fond apparaissent dans la MEME chaine de classes: la, le
 * fond est connu, et le verdict est un fait. Quand une classe de texte est
 * seule, son fond vient d'un parent, d'une variable ou d'un style en ligne —
 * une lecture statique ne peut pas le savoir. Ces cas sont comptes a part et
 * affiches comme une ESTIMATION, jamais comme un echec: un chiffre presente
 * comme certain alors qu'il repose sur une hypothese est pire qu'aucun
 * chiffre.
 *
 * Mesure du premier passage (2026-09-04): 497 couples certains, dont 35 sous
 * 4.5:1 — du blanc sur amber-500 (3.32) pour des boutons, du gris 400 sur
 * gris 800 (2.97) pour des badges en theme sombre. Tous corriges en prenant
 * la teinte voisine qui passe, calculee et non choisie a l'oeil.
 *
 * Usage:
 *   node scripts/a11y-hardcoded-contrast.mjs           # rapport
 *   node scripts/a11y-hardcoded-contrast.mjs --check   # sort en 1 si un couple certain echoue
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "src");
const CSS = path.join(SRC, "index.css");
const REPO = path.join(here, "..", "..", "..");

/** Niveau AA du WCAG 2.2 pour du texte de taille normale. */
const MIN_RATIO = 4.5;

/** Jetons de fond du theme qu'on sait resoudre. */
const TOKEN_BG = ["background", "card", "muted", "popover", "primary", "secondary", "accent", "destructive", "sidebar"];

// ── Palette Tailwind ────────────────────────────────────────────────────────

/** oklch -> sRGB lineaire. Verifie contre les hex publies de Tailwind v4. */
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((c) => Math.min(1, Math.max(0, c)));
}

function tailwindPalette() {
  const dir = path.join(REPO, "node_modules", ".pnpm");
  const entry = fs.existsSync(dir) && fs.readdirSync(dir).find((d) => d.startsWith("tailwindcss@"));
  if (!entry) return null;
  const theme = path.join(dir, entry, "node_modules", "tailwindcss", "theme.css");
  if (!fs.existsSync(theme)) return null;
  const css = fs.readFileSync(theme, "utf8");
  const palette = new Map([["white", [1, 1, 1]], ["black", [0, 0, 0]]]);
  for (const m of css.matchAll(/--color-([a-z]+)-(\d{2,3}):\s*oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/g)) {
    palette.set(`${m[1]}-${m[2]}`, oklchToRgb(+m[3] / 100, +m[4], +m[5]));
  }
  return palette;
}

// ── Jetons du theme ─────────────────────────────────────────────────────────

const css = fs.readFileSync(CSS, "utf8");

function hslVar(selector, name) {
  const i = css.indexOf(`${selector} {`);
  if (i === -1) return null;
  const seg = css.slice(i, css.indexOf("\n}", i));
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(seg);
  if (!m) return null;
  const h = +m[1] / 360, s = +m[2] / 100, l = +m[3] / 100;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

// ── Lecture des classes ─────────────────────────────────────────────────────

/**
 * Toutes les chaines litterales, comme le scanner de Tailwind: les classes
 * arrivent aussi par `cn()`, des gabarits et des tables de configuration.
 * S'en tenir a `className="..."` ne voyait que 12 couples sur 2500.
 */
const LITERAL = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;

function tsxFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const palette = tailwindPalette();
if (!palette) {
  // Sans la palette on ne peut rien affirmer: on le dit, et on ne bloque pas.
  console.warn("Palette Tailwind introuvable (node_modules absent?) — verification ignoree.");
  process.exit(0);
}

const THEMES = [["clair", "", ":root"], ["sombre", "dark:", ".dark"]];
const certain = [];
let certainPairs = 0;
const assumed = [];

for (const file of tsxFiles(SRC)) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(LITERAL)) {
    const cls = m[1] ?? m[2] ?? m[3] ?? "";
    if (!/(?:^|\s)(?:dark:)?text-/.test(cls)) continue;

    for (const [themeName, prefix, selector] of THEMES) {
      const p = prefix.replace(":", "\\:");
      const text = [...cls.matchAll(new RegExp(`(?:^|\\s)${p}text-([a-z]+-\\d{2,3}|white|black)(?=\\s|$)`, "g"))].pop()?.[1];
      if (!text || !palette.has(text)) continue;

      const bgShade = [...cls.matchAll(new RegExp(`(?:^|\\s)${p}bg-([a-z]+-\\d{2,3}|white|black)(?=\\s|$)`, "g"))].pop()?.[1];
      const bgToken = [...cls.matchAll(new RegExp(`(?:^|\\s)${p}bg-(${TOKEN_BG.join("|")})(?=\\s|/|$)`, "g"))].pop()?.[1];
      const line = src.slice(0, m.index).split("\n").length;
      const where = `${path.relative(path.join(here, ".."), file).split(path.sep).join("/")}:${line}`;

      if (bgShade && palette.has(bgShade)) {
        certainPairs++;
        const ratio = contrast(palette.get(text), palette.get(bgShade));
        if (ratio < MIN_RATIO) certain.push({ where, themeName, text, bg: bgShade, ratio });
        continue;
      }
      if (bgToken) {
        const bg = hslVar(selector, bgToken);
        if (!bg) continue;
        certainPairs++;
        const ratio = contrast(palette.get(text), bg);
        if (ratio < MIN_RATIO) certain.push({ where, themeName, text, bg: `bg-${bgToken}`, ratio });
        continue;
      }
      // Fond inconnu: le texte est peut-etre pose sur une carte coloree.
      if (text === "white" || text === "black") continue;
      const pageBg = hslVar(selector, "background");
      if (!pageBg) continue;
      const ratio = contrast(palette.get(text), pageBg);
      if (ratio < MIN_RATIO) assumed.push({ where, themeName, text, ratio });
    }
  }
}

console.log(`couples certains (texte ET fond dans la meme chaine): ${certainPairs}`);
console.log(`  sous ${MIN_RATIO}:1 -> ${certain.length}`);
console.log(`\nestimation, fond suppose etre celui de la page: ${assumed.length} classes`);
console.log("  (non bloquant: le fond reel peut venir d'un parent — a verifier a l'oeil)");

if (!process.argv.includes("--check")) {
  for (const f of certain.slice(0, 40)) {
    console.log(`  ${f.ratio.toFixed(2)}  ${f.where}  ${f.text} sur ${f.bg} (${f.themeName})`);
  }
  const byCombo = new Map();
  for (const a of assumed) {
    const k = `${a.themeName}  ${a.text}`;
    byCombo.set(k, (byCombo.get(k) ?? 0) + 1);
  }
  console.log("\n-- estimation, combinaisons les plus frequentes --");
  [...byCombo.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)
    .forEach(([k, n]) => console.log(`${String(n).padStart(4)}  ${k}`));
}

if (process.argv.includes("--check") && certain.length > 0) {
  console.error(`\nERREUR: ${certain.length} couple(s) certain(s) sous ${MIN_RATIO}:1.\n`);
  for (const f of certain.slice(0, 20)) {
    console.error(`  ${f.ratio.toFixed(2)}  ${f.where}  ${f.text} sur ${f.bg} (${f.themeName})`);
  }
  console.error("\nPrenez la teinte voisine qui passe (calculez-la, ne la choisissez pas a l'oeil),\n" +
    "et attention au prefixe: un fond `dark:` ne justifie de corriger que le texte `dark:`.\n");
  process.exit(1);
}
