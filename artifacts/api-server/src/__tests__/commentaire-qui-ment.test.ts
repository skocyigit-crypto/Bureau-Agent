/**
 * Un commentaire qui renvoie a un NUMERO DE LIGNE ment tot ou tard.
 *
 * Il est faux des que quoi que ce soit change au-dessus, et rien ne le
 * signale : ni la compilation, ni les tests, ni la relecture — puisque le
 * lecteur suivant n'a aucune raison de le soupconner. Il decidera sur sa foi.
 *
 * Ce n'est pas une regle de style. Mesure du 24/09/2026 sur ce depot, deux
 * citations existaient :
 *
 *   - `legal.ts` renvoyait a « ligne 14 » : encore juste ce jour-la ;
 *   - `security.ts` renvoyait a « ligne 256 » pour la mutation soeur
 *     `PATCH /security/settings`, qui se trouve en realite quatre lignes plus
 *     bas. Le lecteur qui suivait le renvoi tombait sur autre chose.
 *
 * Une sur deux avait donc deja pourri, sans que personne l'ait touchee
 * exprès. Le remede n'est pas de corriger le nombre — il repourrira — mais
 * de NOMMER la chose : un identifiant, une route, une construction. Un nom
 * survit au deplacement, et quand il disparait, la recherche ne le trouve
 * plus : le mensonge devient visible.
 *
 * J'ai moi-meme produit les deux variantes en une heure : un « repli de la
 * ligne 240 » que mes propres modifications du jour avaient deja decale, et
 * un « vingt lignes plus haut » qui en faisait vingt-cinq. Puis, en
 * corrigeant le second, j'ai cite une fonction `normaliserTaches` qui
 * n'existe pas. D'ou le second controle ci-dessous.
 *
 * (Classe rapportee par la session BTP-ULTRA le 24/09/2026 : son correctif du
 * matin avait rendu faux, l'apres-midi, deux commentaires qu'elle avait
 * ecrits elle-meme — vrais a 10 h, faux a 15 h.)
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");

/** Les paquets de code source du depot — pas les dossiers construits. */
const PAQUETS = [
  join("artifacts", "api-server", "src"),
  join("artifacts", "mobile", "app"),
  join("artifacts", "mobile", "lib"),
  join("artifacts", "buro-ajani", "src"),
  join("scripts"),
];

const IGNORES = new Set(["node_modules", "dist", "build", ".expo", "static-build", "coverage"]);

function fichiersSource(depart: string): string[] {
  const trouves: string[] = [];
  const parcourir = (dossier: string) => {
    let entrees;
    try { entrees = readdirSync(dossier, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      if (IGNORES.has(e.name)) continue;
      const chemin = join(dossier, e.name);
      if (e.isDirectory()) { parcourir(chemin); continue; }
      if (/\.(ts|tsx|mjs)$/.test(e.name)) trouves.push(chemin);
    }
  };
  parcourir(depart);
  return trouves;
}

const SOURCES = PAQUETS.flatMap((p) => fichiersSource(join(RACINE, p)));

/**
 * Chaque fichier lu UNE fois.
 *
 * Le releve parcourt un millier de fichiers ; le relire a chaque assertion
 * portait ce fichier a trente-cinq secondes, et un controle lent finit par
 * etre retire de la porte. (Piege releve par la session Assise le
 * 24/09/2026 : chez elle, un garde mettait 30,1 s a ne rien trouver pour un
 * delai de 30 s, alors que le travail reel etait d'une seconde.)
 */
const CONTENUS = new Map(SOURCES.map((f) => [f, readFileSync(f, "utf8")]));

/**
 * Le fichier qui DECRIT la classe cite forcement les exemples trouves.
 *
 * Un controle qui interdit un motif doit exempter l'endroit ou le motif est
 * produit comme PREUVE, sinon il s'interdit de documenter ce qu'il garde. On
 * exempte un seul fichier, nomme, et un controle plus bas verifie que
 * l'exemption reste unique — une exemption qui s'elargit finit par tout
 * couvrir.
 */
const FICHIER_QUI_DECRIT = "commentaire-qui-ment.test.ts";

/** Les lignes de commentaire qui renvoient a un numero de ligne. */
function citationsDeLigne(): string[] {
  const trouvees: string[] = [];
  for (const [f, contenu] of CONTENUS) {
    if (f.endsWith(FICHIER_QUI_DECRIT)) continue;
    const lignes = contenu.split(/\r?\n/);
    lignes.forEach((l, i) => {
      const nu = l.trim();
      if (!nu.startsWith("//") && !nu.startsWith("*")) return;
      if (/\b(ligne|lignes|line)\s+\d+/i.test(nu)) {
        trouvees.push(`${f.replace(RACINE, "").replace(/\\/g, "/")}:${i + 1} ${nu.slice(0, 90)}`);
      }
    });
  }
  return trouvees;
}

describe("le releve atteint vraiment le code", () => {
  // Sans cette preuve, « aucune citation trouvee » et « aucun fichier lu »
  // rendent exactement la meme sortie. C'est la faute que la session
  // BTP-ULTRA a commise sur son application mobile — un chemin errone, une
  // liste vide, lue comme une absence.
  it("les cinq paquets rendent des fichiers", () => {
    for (const p of PAQUETS) {
      expect(fichiersSource(join(RACINE, p)).length, `${p} : aucun fichier lu`).toBeGreaterThan(5);
    }
  });

  it("le corpus est de l'ordre du millier de fichiers", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
  });

  it("et il contient bien des commentaires a examiner", () => {
    const commentes = [...CONTENUS.values()].filter((t) => /^\s*(\/\/|\*)/m.test(t));
    expect(commentes.length, "aucun commentaire lu : le motif ne mord plus").toBeGreaterThan(300);
  });

  it("l'exemption ne couvre qu'un seul fichier", () => {
    // Une exemption qui s'elargit finit par tout couvrir, et le controle rend
    // alors un vert qui ne prouve rien.
    const exemptes = SOURCES.filter((f) => f.endsWith(FICHIER_QUI_DECRIT));
    expect(exemptes.length, "l'exemption doit viser exactement le fichier qui decrit la classe").toBe(1);
  });

  it("et ce fichier contient bien les exemples qu'elle protege", () => {
    // Si les citations historiques disparaissaient, l'exemption deviendrait
    // sans objet — et elle laisserait passer de vraies citations demain.
    const src = CONTENUS.get(SOURCES.find((f) => f.endsWith(FICHIER_QUI_DECRIT))!)!;
    expect(src).toMatch(/ligne 256/);
  });
});

describe("aucun commentaire ne renvoie a un numero de ligne", () => {
  it("le depot n'en contient plus", () => {
    expect(
      citationsDeLigne(),
      "un numero de ligne pourrit des que quoi que ce soit change au-dessus : nommer la chose",
    ).toEqual([]);
  });

  it("le motif attrape bien les deux formes qui existaient", () => {
    // Garde-fou du controle : une regex qui ne mord plus rendrait une liste
    // vide, et une liste vide satisfait l'assertion precedente.
    const faux = [
      "// requireAdmin comme la mutation soeur /security/settings (ligne 256): sans ce",
      "  // Ce routeur entier est monte derriere requireSuperAdmin (ligne 14) — tout",
      " * repli de la ligne 240",
      "// see line 42 for details",
    ];
    for (const l of faux) {
      expect(/\b(ligne|lignes|line)\s+\d+/i.test(l.trim()), `non detecte : ${l}`).toBe(true);
    }
  });

  it("et il ne mord pas sur du texte innocent", () => {
    // Un controle qui crie a tort n'est plus lu. « en ligne » et « ligne de
    // commande » ne renvoient a rien.
    for (const l of [
      "// le verdict vivait en ligne dans verif-ecrans.mjs",
      "// une ligne de commande suffit",
      "// 200 lignes de configuration",
    ]) {
      expect(/\b(ligne|lignes|line)\s+\d+/i.test(l.trim()), `faux positif : ${l}`).toBe(false);
    }
  });
});

/*
 * CE QUE CE FICHIER NE GARDE PAS, et pourquoi il vaut mieux l'ecrire que le
 * laisser croire.
 *
 * L'autre moitie de la classe est le commentaire qui cite un NOM inexistant.
 * Je l'ai produite en corrigeant la premiere : remplacant « vingt lignes plus
 * haut », j'ai cite une fonction `normaliserTaches` qui n'a jamais existe.
 * Remplacer un renvoi qui pourrit par un renvoi FAUX est un recul.
 *
 * J'avais d'abord ecrit le controle sous la forme d'une table de couples
 * (fichier, nom) tenue a la main. Sabotage mesure : en remplacant le nom DANS
 * LE COMMENTAIRE, le controle restait vert — il verifiait ma table, pas le
 * commentaire. Un test dont on ecrit soi-meme la reponse ne verifie rien.
 *
 * La version derivee — extraire les noms entre accents graves des
 * commentaires et exiger qu'ils existent dans le code — a ete MESUREE sur les
 * 1010 fichiers du depot :
 *
 *   - toutes formes confondues : 91 noms introuvables, en immense majorite
 *     legitimes (colonnes SQL `valid_until`, API externes `messages.modify`,
 *     types de machine `E2_HIGHCPU_4`, paquets npm, noms de fichiers) ;
 *   - restreinte a la forme d'un identifiant JS local (minuscule puis
 *     majuscule, ni snake_case ni ALL_CAPS ni nom pointe) : 24, dont la
 *     plupart encore legitimes — `idleTimeoutMillis` de pg,
 *     `batchEmbedContents` de Gemini, `requireAuthentication` d'Expo, et des
 *     placeholders assumes comme `purgeX`.
 *
 * Une porte a ce taux de bruit ne signale pas un probleme : elle en fabrique
 * vingt, et cesse d'etre lue — c'est exactement ce qui s'est passe avec un
 * releve de routes qui annoncait 42 routes mortes dont 41 ne l'etaient pas.
 * La rendre utilisable demanderait une liste d'exceptions tenue a la main, et
 * une liste tenue a la main est precisement la chose qui pourrit.
 *
 * Ce fichier garde donc la moitie qui se garde proprement — le renvoi a un
 * numero de ligne, zero faux positif mesure — et dit ce qu'il laisse dehors.
 */
