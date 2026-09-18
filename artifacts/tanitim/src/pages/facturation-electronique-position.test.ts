import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Facturation electronique : le contrat doit dire ou s'arrete le service.
 *
 * La reforme (ordonnance 2021-1190, art. 289 bis et 290 CGI) est entree en
 * vigueur le 1er septembre 2026 : une facture ne circule plus par courriel,
 * elle transite par une plateforme agreee qui la valide avant transmission.
 *
 * Mesure du 18/09 : le produit genere bien un PDF Factur-X profil BASIC avec
 * son XML CII attache, controle contre le noyau EN 16931 avant emission
 * (services/facturx.ts, services/conformite-en16931.ts). Il ne TRANSMET pas —
 * l'editeur n'est pas immatricule comme plateforme agreee. Et AUCUN document
 * contractuel ne le disait : ni les CGV, ni la vitrine, ni la page tarifs.
 *
 * Le risque n'etait pas l'exageration, c'etait le silence. Un client pouvait
 * croire que s'abonner suffisait a etre en regle, le decouvrir a la premiere
 * facture rejetee, et se retourner vers l'editeur — qui n'avait rien ecrit
 * pour montrer qu'il n'avait jamais assume cette obligation.
 *
 * Ces controles relient la clause au code qui la rend vraie : si le
 * generateur Factur-X disparaissait, la clause deviendrait une promesse vide
 * et ces tests tomberaient.
 */

const PAGES_DIR = import.meta.dirname;
const RACINE = path.resolve(PAGES_DIR, "..", "..", "..", "..");
const lire = (p: string) => fs.readFileSync(p, "utf8");
const cgv = lire(path.join(PAGES_DIR, "cgv.tsx"));

describe("les CGV prennent position sur la facturation electronique", () => {
  it("consacrent un article a la question", () => {
    expect(cgv, "aucun article: le client ne sait pas ce qu'il achete").toMatch(/Facturation électronique/i);
  });

  it("annoncent le format effectivement produit", () => {
    expect(cgv).toMatch(/Factur-X/);
    expect(cgv, "le profil engage: BASIC porte le detail des lignes, MINIMUM non").toMatch(/BASIC/);
  });

  it("citent la norme contre laquelle les factures sont controlees", () => {
    expect(cgv).toMatch(/EN 16931/);
  });

  it("disent que l'editeur ne transmet pas", () => {
    expect(cgv, "sans cette phrase, le silence vaut promesse").toMatch(/n'est pas immatriculé/);
    expect(cgv).toMatch(/plateforme agréée/i);
  });

  it("nomment ce qui reste a la charge du client", () => {
    expect(cgv).toMatch(/charge du client/i);
  });

  it("ecartent la garantie de conformite fiscale, qui depend des saisies du client", () => {
    expect(cgv).toMatch(/ne garantit pas la conformité fiscale/i);
  });

  it("gardent la numerotation continue et sans doublon", () => {
    const numeros = [...cgv.matchAll(/mb-3">(\d+)\. /g)].map(m => Number(m[1]));
    expect(numeros.length).toBeGreaterThan(10);
    expect(numeros, "articles renumerotes de travers apres insertion").toEqual(
      numeros.map((_, i) => i + 1),
    );
  });

  it("ne renvoient a aucun article deplace", () => {
    // Les seuls renvois internes visent les articles 3 et 6, anterieurs a
    // l'insertion. Un renvoi vers un numero desormais occupe par un autre
    // texte serait invisible a la lecture et faux au fond.
    const renvois = [...cgv.matchAll(/l'article (\d+)/g)].map(m => Number(m[1]));
    expect(renvois.length).toBeGreaterThan(0);
    for (const n of renvois) expect(n, `renvoi vers l'article ${n}`).toBeLessThan(8);
  });
});

describe("la clause repose sur du code qui existe", () => {
  const facturx = lire(path.join(RACINE, "artifacts", "api-server", "src", "services", "facturx.ts"));
  const conformite = lire(path.join(RACINE, "artifacts", "api-server", "src", "services", "conformite-en16931.ts"));

  it("le generateur Factur-X est present", () => {
    expect(facturx.length, "clause sans generateur = promesse vide").toBeGreaterThan(500);
  });

  it("il produit bien le profil annonce dans les CGV", () => {
    expect(facturx, "les CGV annoncent BASIC: le code doit le produire").toMatch(/basic/i);
  });

  it("le controle EN 16931 annonce par les CGV existe", () => {
    expect(conformite).toMatch(/EN 16931|en16931/i);
  });

  it("aucune page publique ne promet la transmission", () => {
    // L'inverse de la clause: promettre ailleurs ce que l'article 8 ecarte.
    for (const page of ["home.tsx", "cgu.tsx", "cgv.tsx"]) {
      const source = lire(path.join(PAGES_DIR, page));
      expect(
        source,
        `${page}: promesse de transmission alors que l'editeur n'est pas plateforme agreee`,
      ).not.toMatch(/transmission (automatique|à l'administration)|nous transmettons vos factures/i);
    }
  });
});
