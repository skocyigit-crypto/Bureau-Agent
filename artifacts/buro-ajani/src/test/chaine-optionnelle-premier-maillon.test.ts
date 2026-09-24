/**
 * `data?.contacts.map(...)` ne protege que du PREMIER maillon.
 *
 * L'optionnel court-circuite la chaine quand `data` est absent. Mais si
 * `data` EST la et que sa forme differe — charge tronquee, reponse d'une
 * revision plus ancienne pendant un deploiement progressif, corps d'erreur
 * rendu en 200 — alors `undefined.map` leve, et l'ErrorBoundary emporte la
 * page ENTIERE. L'utilisateur ne perd pas une liste : il perd l'ecran.
 *
 * Le defaut est invisible au type TypeScript, qui decrit ce que la reponse
 * est CENSEE contenir. Le type est une promesse, pas une verification.
 *
 * Ce depot a deja rencontre le cas jumeau : un onglet reste ouvert pendant un
 * deploiement demande un fragment de code supprime. Meme cause — deux
 * versions qui se parlent — et meme degat : un ecran qui tombe entier.
 *
 * (Classe rapportee par la session BatiFlow le 24/09/2026 : onze occurrences
 * chez elle, trois ecrans complets par terre, dont un que le menu propose en
 * permanence. Elle releve aussi qu'un ecran casse CACHE ses autres defauts —
 * son audit d'accessibilite ne voyait pas trois contrastes illisibles, dont
 * un titre a 1,04:1, tant que la page tombait avant de se rendre.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..");

describe("le danger lui-meme, pas la regle de style", () => {
  // On demontre le mecanisme avant de l'interdire : une regle dont on ne
  // sait plus pourquoi elle existe finit par etre contournee.
  const lire = (reponse: any) => reponse?.contacts.length;
  const lireGarde = (reponse: any) => reponse?.contacts?.length;

  it("absent : la chaine court-circuite, rien ne leve", () => {
    expect(lire(undefined)).toBeUndefined();
    expect(lire(null)).toBeUndefined();
  });

  it("present mais d'une autre forme : la chaine LEVE", () => {
    // Le cas reel : la route a repondu 200, avec autre chose.
    expect(() => lire({})).toThrow();
    expect(() => lire({ error: "Organisation non identifiee." })).toThrow();
  });

  it("le second maillon optionnel encaisse la meme reponse", () => {
    expect(lireGarde({})).toBeUndefined();
    expect(lireGarde({ error: "Organisation non identifiee." })).toBeUndefined();
  });

  it("et ne change rien au cas normal", () => {
    expect(lireGarde({ contacts: [1, 2, 3] })).toBe(3);
  });
});

/**
 * Les sites ou un maillon nu suit un maillon optionnel, dans les pages.
 *
 * On lit les pages et les hooks : c'est la que vit la lecture des reponses.
 */
function maillonsNus(): string[] {
  const trouves: string[] = [];
  const motif = /([A-Za-z_][A-Za-z0-9_]*)\?\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const parcourir = (dossier: string) => {
    for (const e of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, e.name);
      if (e.isDirectory()) { parcourir(chemin); continue; }
      if (!/\.tsx?$/.test(e.name) || /\.test\./.test(e.name)) continue;
      const lignes = readFileSync(chemin, "utf8").split(/\r?\n/);
      lignes.forEach((l, i) => {
        for (const m of l.matchAll(motif)) trouves.push(`${e.name}:${i + 1} ${m[0]}`);
      });
    }
  };
  parcourir(join(SRC, "pages"));
  parcourir(join(SRC, "hooks"));
  return trouves;
}

/**
 * Les seuls sites tolerés, avec la raison.
 *
 * Elle est la meme dans les deux cas : la forme ne vient PAS du serveur. Le
 * second maillon est pose par le code appelant, dans le meme fichier, et ne
 * peut donc pas changer sous nos pieds. Y ajouter un optionnel affaiblirait
 * le signal — un `?.` dit « ceci peut manquer », et ici rien ne manque.
 */
const TOLERES = [
  // `opts` est l'argument passe a confirmAction(), construit sur place.
  "use-confirm.tsx:80 current?.opts.title",
  "use-confirm.tsx:81 current?.opts.description",
  "use-confirm.tsx:89 current?.opts.cancelLabel",
  "use-confirm.tsx:93 current?.opts.destructive",
  "use-confirm.tsx:95 current?.opts.confirmLabel",
  // `licenseDialog` est pose par l'ecran sous la forme `{ org, ... }`.
  "organisations.tsx:2346 licenseDialog?.org.name",
  "organisations.tsx:2393 licenseDialog?.org.name",
];

describe("aucune lecture de reponse ne s'arrete au premier maillon", () => {
  it("le releve parcourt bien les pages", () => {
    // Un dossier deplace rendrait une liste vide, et une liste vide est
    // satisfaite par n'importe quel code.
    const fichiers = readdirSync(join(SRC, "pages"));
    expect(fichiers.length, "aucune page lue").toBeGreaterThan(20);
  });

  it("aucun site hors de la liste des toleres", () => {
    const hors = maillonsNus().filter((s) => !TOLERES.includes(s));
    expect(
      hors,
      "un maillon nu apres un optionnel : une reponse d'une autre forme emporte la page entiere",
    ).toEqual([]);
  });

  it("chaque tolere existe encore — sinon la liste ment", () => {
    // Une tolerance qui ne correspond plus a rien laisse croire qu'un site a
    // ete examine alors qu'il a simplement disparu.
    const presents = maillonsNus();
    const fantomes = TOLERES.filter((t) => !presents.includes(t));
    expect(fantomes, "tolerance devenue sans objet : a retirer de la liste").toEqual([]);
  });

  it("les listes rendues par l'API sont bien gardees aux deux maillons", () => {
    // Les quatre ecrans de liste : ce sont eux que l'utilisateur ouvre le
    // plus, et eux qui rendaient `data?.x.map(...)`.
    for (const [page, clef] of [
      ["calls.tsx", "calls"], ["contacts.tsx", "contacts"],
      ["messages.tsx", "messages"], ["tasks.tsx", "tasks"],
    ] as const) {
      const src = readFileSync(join(SRC, "pages", page), "utf8");
      expect(src, `${page} : lecture non gardee`).not.toMatch(new RegExp(`data\\?\\.${clef}\\.`));
      expect(src, `${page} : la lecture gardee a disparu`).toMatch(new RegExp(`data\\?\\.${clef}\\?\\.`));
    }
  });
});
