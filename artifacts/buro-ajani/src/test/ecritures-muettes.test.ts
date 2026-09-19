/**
 * L'autre forme du meme defaut : `catch {}` sur une ecriture.
 *
 * `echecs-silencieux.test.ts` garde le cas ou le serveur REPOND une erreur.
 * Celui-ci garde le cas ou la requete n'aboutit meme pas — reseau coupe,
 * session expiree, serveur injoignable. Le bloc `catch` est alors vide : la
 * boite de dialogue se ferme, le formulaire est reinitialise, la liste est
 * rechargee sans la nouvelle ligne, et rien ne dit pourquoi.
 *
 * C'est pire que le premier cas, parce que la saisie est PERDUE : le
 * formulaire a deja ete vide au moment ou l'on decouvre que rien n'est
 * enregistre.
 *
 * Comme l'autre, c'est un CLIQUET. Les reparer tous d'un coup serait une
 * modification massive et peu sure ; empecher le nombre de monter est
 * immediat, et chaque correction fait baisser le plafond.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Plafond courant. A BAISSER a chaque correction — jamais a monter.
 *
 * 19/09 : 43 au premier comptage, ramene a 39 en traitant les quatre
 * enregistrements de formulaire ou la saisie etait perdue sans un mot
 * (contacts, appels, agenda).
 */
const PLAFOND = 39;

const RACINES = [
  join(import.meta.dirname, "..", "..", "..", "mobile", "app"),
  join(import.meta.dirname, "..", "pages"),
];

function fichiers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return p.endsWith(".tsx") && !p.includes(".test.") ? [p] : [];
  });
}

/**
 * Les `catch {}` vides qui suivent une ECRITURE.
 *
 * La fenetre de 22 lignes remonte jusqu'a l'appel : au-dela, le `catch`
 * appartient vraisemblablement a autre chose. Les lectures sont volontairement
 * hors du compte — une liste vide se voit, une saisie perdue non.
 */
function muettes(): Array<{ fichier: string; ligne: number }> {
  const out: Array<{ fichier: string; ligne: number }> = [];
  for (const racine of RACINES) {
    for (const f of fichiers(racine)) {
      const lignes = readFileSync(f, "utf8").split(/\r?\n/);
      lignes.forEach((l, i) => {
        if (!/\} catch \{\s*\}/.test(l)) return;
        const avant = lignes.slice(Math.max(0, i - 22), i).join("\n");
        if (!/await (create|update|delete)\w+\(|method: "(POST|PUT|PATCH|DELETE)"/.test(avant)) return;
        out.push({ fichier: f, ligne: i + 1 });
      });
    }
  }
  return out;
}

describe("une saisie perdue ne doit plus l'etre en silence", () => {
  const releve = muettes();

  it("le comptage trouve bien quelque chose a compter", () => {
    // Garde-fou du controle: une detection tombee a zero ferait passer
    // l'assertion suivante sans rien garantir.
    expect(releve.length, "plus rien de detecte: la detection est cassee").toBeGreaterThan(5);
  });

  it("leur nombre ne depasse pas le plafond", () => {
    const apercu = releve.slice(0, 5)
      .map((r) => `${r.fichier.split(/[\\/]/).slice(-2).join("/")}:${r.ligne}`).join(", ");
    expect(
      releve.length,
      `une nouvelle ecriture muette a ete ajoutee. Par exemple: ${apercu}`,
    ).toBeLessThanOrEqual(PLAFOND);
  });

  it("le plafond suit la realite: il doit etre baisse quand on corrige", () => {
    expect(
      PLAFOND - releve.length,
      `${releve.length} ecritures muettes pour un plafond de ${PLAFOND}: abaisser PLAFOND`,
    ).toBeLessThanOrEqual(3);
  });

  it("les enregistrements de formulaire deja traites disent leur echec", () => {
    // Ce sont ceux ou la saisie etait perdue: le formulaire venait d'etre vide.
    const traites = [
      join("(tabs)", "contacts.tsx"),
      join("(tabs)", "calls.tsx"),
      "calendar.tsx",
    ];
    for (const nom of traites) {
      const source = readFileSync(join(RACINES[0]!, nom), "utf8");
      expect(
        source,
        `${nom}: l'echec d'un enregistrement y est redevenu muet`,
      ).toMatch(/catch \{ Alert\.alert\(t\("common\.error"\), t\("common\.actionFailed"\)\); \}/);
    }
  });
});
