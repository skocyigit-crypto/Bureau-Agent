import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Budget d'accessibilite mobile — cliquet anti-regression.
 *
 * Un controle sans nom ne casse ni le typage ni le rendu: VoiceOver et
 * TalkBack se contentent de ne rien annoncer. La faute revient donc par
 * copier-coller sans que rien ne la signale. Ce fichier fige l'etat atteint.
 *
 * Les budgets sont des plafonds constates, pas des objectifs. Quand une
 * correction fait baisser un compte, baisser le budget dans la foulee — c'est
 * ce qui transforme un progres en acquis.
 *
 * Deux enseignements de la campagne de correction sont verrouilles ici, parce
 * qu'ils ont ete appris a nos depens:
 *
 *  - une balise s'ecrit souvent sur plusieurs lignes; ne lire que la premiere
 *    a fait passer pour muets trois controles deja etiquetes;
 *  - un fond de modale ou une carte qui absorbe le tap n'est pas un bouton.
 *    Lui donner `accessibilityRole="button"` place un bouton plein ecran
 *    devant l'utilisateur.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "static-build", ".expo"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Balise ouvrante COMPLETE — les attributs debordent souvent sur plusieurs lignes. */
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

const PRESSABLE = /<(TouchableOpacity|Pressable|TouchableHighlight)\b/g;
const FILES = walk(ROOT);

interface Control {
  where: string;
  tag: string;
  body: string;
  kind: "labelled" | "textual" | "silent";
}

function controls(): Control[] {
  const out: Control[] = [];
  for (const file of FILES) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(PRESSABLE)) {
      const tag = openingTag(src, m.index);
      if (!tag) continue;
      const start = m.index + tag.length;
      const close = src.indexOf(`</${m[1]}>`, start);
      const body = src.slice(start, close === -1 ? start + 800 : close);
      const where = `${path.relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}`;
      const kind = /accessibilityLabel/.test(tag)
        ? "labelled"
        : /<Text\b/.test(body)
          ? "textual"
          : "silent";
      out.push({ where, tag, body, kind });
    }
  }
  return out;
}

describe("budget d'accessibilite mobile", () => {
  const all = controls();

  // ~174 muets au depart. 144 corriges par lot, puis 10 relus un par un.
  const SILENT_BUDGET = 21;

  it(`ne laisse pas plus de ${SILENT_BUDGET} controles muets`, () => {
    const silent = all.filter((c) => c.kind === "silent");
    expect(
      silent.length,
      `Controles sans nom accessible (budget ${SILENT_BUDGET}):\n${silent.map((c) => c.where).join("\n")}`,
    ).toBeLessThanOrEqual(SILENT_BUDGET);
  });

  it("annonce comme boutons les controles qui en sont", () => {
    // Sans `accessibilityRole`, un lecteur d'ecran lit le libelle sans dire
    // qu'il est activable. Aucun controle nomme ne doit rester sans role.
    const missing = all.filter(
      (c) => c.kind === "labelled" && !/accessibilityRole/.test(c.tag),
    );
    expect(
      missing.length,
      `Controles nommes mais sans role:\n${missing.map((c) => c.where).join("\n")}`,
    ).toBe(0);
  });
});

describe("pieges appris a nos depens", () => {
  const all = controls();

  it("ne donne pas de role de bouton a un fond de modale ou a une carte", () => {
    const NOT_A_CONTROL = /(overlay|backdrop|pickerCard|modalCard|sheetCard)/i;
    const NOOP = /onPress=\{\s*\(\)\s*=>\s*\{\s*\}\s*\}/;
    const wrong = all.filter(
      (c) =>
        /accessibilityRole="button"/.test(c.tag) &&
        (NOT_A_CONTROL.test(c.tag) || NOOP.test(c.tag)),
    );
    expect(
      wrong.length,
      `Role de bouton sur un element qui n'en est pas un:\n${wrong.map((c) => c.where).join("\n")}`,
    ).toBe(0);
  });

  it("n'etiquette « retour » que ce qui revient en arriere", () => {
    // Un chevron gauche signifie « retour » dans un en-tete et « mois
    // precedent » dans un calendrier: le libelle doit suivre le gestionnaire,
    // pas l'icone.
    const GOES_BACK = /router\.back\(\)|goBack\(\)|onClose|setShow\w*\(false\)|\(null\)/;
    const wrong = all.filter(
      (c) =>
        /accessibilityLabel=\{t\("common\.back"\)\}/.test(c.tag) &&
        !GOES_BACK.test(c.tag),
    );
    expect(
      wrong.length,
      `Libelle « retour » sur un controle qui fait autre chose:\n${wrong.map((c) => c.where).join("\n")}`,
    ).toBe(0);
  });

  it("traduit chaque nom accessible dans toutes les langues livrees", () => {
    const dir = path.join(ROOT, "lib", "i18n", "locales");
    const keys = [
      "back", "close", "delete", "confirm", "add",
      "refresh", "send", "call", "email", "previousMonth", "nextMonth",
      "showPassword", "hidePassword", "download", "helpful", "notHelpful", "pin",
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
