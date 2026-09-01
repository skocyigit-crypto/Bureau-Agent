import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Budget d'accessibilite — cliquet anti-regression.
 *
 * Les corrections ponctuelles ne tiennent pas: le motif fautif revient par
 * copier-coller, et personne ne s'en apercoit parce qu'un nom accessible
 * manquant ne casse ni le typage ni le rendu. Ce fichier fige donc l'etat
 * atteint et interdit qu'il empire.
 *
 * Les budgets ci-dessous ne sont PAS des objectifs: ce sont des plafonds
 * constates. Quand une correction fait baisser un compte, il faut baisser le
 * budget dans la foulee — c'est ce qui transforme un progres en acquis. Les
 * augmenter demande une justification explicite dans la revue.
 */

const SRC = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Balise ouvrante complete, meme repartie sur plusieurs lignes. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length && i < from + 4000; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return src.slice(from, i + 1);
  }
  return "";
}

const FILES = walk(SRC);

/**
 * Contenu se reduisant a une seule icone auto-fermante, eventuellement choisie
 * par un ternaire. Un bouton qui porte aussi du texte, ou un `<span
 * class="sr-only">`, a deja un nom.
 */
const ICON_BODY =
  /^\s*(?:\{[^}]*\?\s*)?<[A-Z][A-Za-z0-9]*\b[^>]*\/>(?:\s*:\s*<[A-Z][A-Za-z0-9]*\b[^>]*\/>\s*\})?\s*$/;

/**
 * Bouton dont le seul contenu est une icone. Sans nom accessible, un lecteur
 * d'ecran annonce « bouton » et rien d'autre — WCAG 2.2 4.1.2, niveau A.
 *
 * La balise ouvrante est delimitee par `openingTag`, PAS par un `[^>]*`: les
 * attributs contiennent tres souvent une fonction flechee (`onClick={e => …}`)
 * dont le `>` fermait la balise prematurement. Le motif ne reconnaissait alors
 * plus le bouton et le comptait comme conforme. C'est ce qui faisait tenir ce
 * budget a 16 alors que le compte reel etait de 105 — l'angle mort couvrait
 * precisement les boutons les plus courants, ceux qui portent un gestionnaire
 * de clic en ligne.
 */
function unnamedIconButtons(): string[] {
  const found: string[] = [];
  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(Button|button)\b/g)) {
      const tag = openingTag(src, m.index);
      if (!tag || tag.endsWith("/>")) continue; // auto-fermante: aucun contenu
      const close = `</${m[1]}>`;
      const bodyStart = m.index + tag.length;
      const bodyEnd = src.indexOf(close, bodyStart);
      // Au-dela, la fermeture trouvee appartient a un bouton imbrique ou
      // eloigne: on ne cherche pas a analyser ces cas ici.
      if (bodyEnd < 0 || bodyEnd - bodyStart > 400) continue;
      if (!ICON_BODY.test(src.slice(bodyStart, bodyEnd))) continue;
      const attrs = tag.slice(m[1].length + 1, -1);
      if (/aria-label|aria-labelledby|title=/.test(attrs)) continue;
      found.push(`${path.relative(SRC, file)}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  return found;
}

/** Tailwind -> pixels, pour les classes de taille imposee. */
const PX: Record<string, number> = {
  "0.5": 2, "1": 4, "1.5": 6, "2": 8, "2.5": 10, "3": 12, "3.5": 14,
  "4": 16, "5": 20, "6": 24, "7": 28, "8": 32, "9": 36, "10": 40, "11": 44, "12": 48,
};

/**
 * Cibles de pointage sous 24x24 CSS px — WCAG 2.2 2.5.8, niveau AA (verifie
 * sur w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
 *
 * Le critere admet des exceptions (espacement suffisant, cible equivalente
 * ailleurs, lien en ligne, rendu natif, taille essentielle). Ce test ne les
 * evalue pas — il compte, pour empecher que le nombre augmente. Chaque cas
 * doit etre juge a la main avant d'etre declare conforme ou corrige.
 */
function undersizedTargets(): string[] {
  const found: string[] = [];
  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(Button|button)\b/g)) {
      const tag = openingTag(src, m.index);
      const h = tag.match(/\bh-(\d+(?:\.5)?)\b/);
      const w = tag.match(/\bw-(\d+(?:\.5)?)\b/);
      if (!h && !w) continue; // taille non imposee: depend du contenu
      const min = Math.min(h ? PX[h[1]] ?? 99 : 99, w ? PX[w[1]] ?? 99 : 99);
      if (min < 24) {
        found.push(`${path.relative(SRC, file)}:${src.slice(0, m.index).split("\n").length} (${min}px)`);
      }
    }
  }
  return found;
}

describe("budget d'accessibilite", () => {
  // 16 -> 105 le 2026-09-01. Ce n'est PAS une regression: rien n'a empire,
  // c'est le detecteur qui vient de cesser de mentir. Son ancien motif
  // s'arretait au premier `>`, y compris celui d'une fonction flechee dans un
  // attribut — donc tout bouton portant un `onClick={e => …}` lui echappait,
  // c'est-a-dire la majorite. Les « 58 au depart, 42 corriges » d'origine
  // etaient comptes avec cet angle mort et ne decrivaient qu'une fraction du
  // reel.
  //
  // Un budget faux est pire qu'un budget haut: il annonce un acquis qui
  // n'existe pas. On fige donc le compte reel, et il redescend a chaque lot
  // corrige. Les 16 d'origine ne sont toujours pas corrigeables (fichiers
  // tenus par une autre session), le reste l'est.
  //
  // Premier lot: 105 -> 79. Ce sont les boutons dont l'icone nomme deja
  // l'action sans ambiguite (corbeille, fermeture, telechargement...), donc
  // ceux qu'une cle `common.*` existante etiquette sans inventer de
  // formulation ni toucher aux six fichiers de langue. L'icone recoit
  // `aria-hidden` dans le meme geste: une fois le bouton nomme, la laisser
  // exposee ferait annoncer la meme chose deux fois.
  //
  // Les 79 restants demandent des libelles nouveaux (pagination, plier/
  // deplier, bascules de vue) — donc une traduction dans chaque langue, et
  // une decision de formulation. Lot suivant.
  //
  // Cas limite assume: un bouton enveloppe dans un Tooltip Radix est compte.
  // Le tooltip pose `aria-describedby`, donc une DESCRIPTION; le critere
  // 4.1.2 exige un NOM. Un lecteur d'ecran annonce toujours « bouton ».
  const UNNAMED_BUDGET = 79;

  it(`ne laisse pas plus de ${UNNAMED_BUDGET} boutons-icone sans nom accessible`, () => {
    const found = unnamedIconButtons();
    expect(
      found.length,
      `Boutons sans nom accessible (budget ${UNNAMED_BUDGET}):\n${found.join("\n")}`,
    ).toBeLessThanOrEqual(UNNAMED_BUDGET);
  });

  // Etat constate au moment de la mesure. Chacune reste a juger au regard des
  // exceptions du critere avant correction.
  //
  // 13 -> 12 le 2026-09-01: le compte reel etait retombe a 12 sans que le
  // plafond suive. Un budget qui traine au-dessus du reel laisse rentrer une
  // regression gratuitement — c est exactement ce que ce cliquet existe pour
  // empecher. Mesure en resserrant jusqu au point de rupture: 12 passe, 11
  // echoue.
  const UNDERSIZED_BUDGET = 12;

  it(`ne laisse pas plus de ${UNDERSIZED_BUDGET} cibles sous 24px`, () => {
    const found = undersizedTargets();
    expect(
      found.length,
      `Cibles sous 24x24 (WCAG 2.5.8 AA, budget ${UNDERSIZED_BUDGET}):\n${found.join("\n")}`,
    ).toBeLessThanOrEqual(UNDERSIZED_BUDGET);
  });
});

describe("acquis verrouilles", () => {
  it("garde le lien d'evitement et sa cible", () => {
    // WCAG 2.2 2.4.1 (A): sans lui, la barre laterale doit etre parcourue en
    // entier, sur chaque page, avant d'atteindre le contenu.
    const layout = fs.readFileSync(path.join(SRC, "components/layout.tsx"), "utf8");
    expect(layout).toContain('href="#contenu"');
    expect(layout).toContain('id="contenu"');
    // La cible doit pouvoir recevoir le focus, sinon le saut deplace la vue
    // mais pas le focus clavier.
    expect(layout).toMatch(/<main id="contenu" tabIndex=\{-1\}/);
  });

  it("garde une langue et un sens d'ecriture pilotes par la locale", () => {
    // L'arabe est livre: un `lang`/`dir` fige en francais casserait a la fois
    // la restitution vocale et la mise en page RTL.
    const i18n = fs.readFileSync(path.join(SRC, "i18n/index.tsx"), "utf8");
    expect(i18n).toContain('root.setAttribute("lang", lang)');
    expect(i18n).toContain('root.setAttribute("dir", dir)');
  });

  it("traduit chaque nom accessible dans toutes les langues livrees", () => {
    // Une cle manquante se lit a voix haute telle quelle: « common.refresh ».
    const dir = path.join(SRC, "i18n", "locales");
    const keys = [
      "close", "delete", "edit", "search", "save", "refresh", "moreActions",
      "send", "copy", "download", "openExternal", "viewDetail", "assign",
      "selectAll", "showPassword", "hidePassword", "skipToContent",
    ];
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
        common?: Record<string, string>;
      };
      for (const key of keys) {
        const value = json.common?.[key];
        expect(typeof value, `${file}: common.${key} manquant`).toBe("string");
        expect(value!.trim().length, `${file}: common.${key} vide`).toBeGreaterThan(0);
      }
    }
  });
});
