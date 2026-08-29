import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pages legales — ce qui peut etre publie, et ce qui ne peut pas l'etre.
 *
 * Verifie sur service-public.gouv.fr (fiche F31228, base LCEN art. 6 et 19):
 * le numero d'immatriculation au RCS et le TELEPHONE de l'hebergeur sont
 * obligatoires; le SIRET ne remplace pas le RCS. Le defaut de mentions legales
 * est puni d'un an d'emprisonnement et 75 000 € d'amende.
 *
 * Ces valeurs sont des faits propres a la societe (Kbis, contrat
 * d'hebergement) ou des decisions commerciales. Elles ne peuvent pas etre
 * devinees, et une valeur inventee sur une page legale engage la societe.
 *
 * D'ou deux mecanismes, et un principe commun: rien d'incomplet ne doit
 * atteindre le public, mais l'attente d'une saisie ne doit pas non plus
 * bloquer les deploiements sans rapport.
 *
 *  - Mentions legales: chaque valeur manquante fait disparaitre SA ligne
 *    (`@/lib/legal-info`). La page reste publiable et n'est pas degradee — la
 *    mention manquait deja avant. La remplir suffit a corriger la page.
 *  - CGV: les decisions manquantes sont au milieu de phrases contractuelles,
 *    donc la page ne peut pas etre publiee a moitie. Elle reste un projet NON
 *    ROUTE tant qu'elles ne sont pas prises. C'est ce que ce test verrouille:
 *    on ne peut pas la mettre en ligne par inadvertance.
 */

const PAGES_DIR = import.meta.dirname;
const SRC = path.resolve(PAGES_DIR, "..");

const read = (p: string) => fs.readFileSync(p, "utf8");
const readPage = (file: string) => read(path.join(PAGES_DIR, file));

/** Marqueurs de valeur en attente, quelle que soit la page. */
const PENDING = /<<[^>]*(à completer|à decider)[^>]*>>/g;

describe("pages publiees", () => {
  it("n'affichent aucun marqueur de valeur en attente", () => {
    // Une page legale affichant « à completer » est un defaut plus visible
    // encore que la mention manquante.
    for (const file of ["mentions-legales.tsx", "confidentialite.tsx", "cgu.tsx", "accessibilite.tsx"]) {
      const markers = readPage(file).match(PENDING) ?? [];
      expect(markers, `${file}: ${markers.join(" | ")}`).toEqual([]);
    }
  });

  it("omettent les mentions non renseignees au lieu de les inventer", () => {
    const source = readPage("mentions-legales.tsx");
    expect(source).toContain("isPublished(LEGAL_INFO.rcs)");
    expect(source).toContain("isPublished(LEGAL_INFO.hebergeurTelephone)");
  });

  it("conservent les mentions deja obtenues", () => {
    const source = readPage("mentions-legales.tsx");
    for (const mention of ["SIRET", "TVA intracommunautaire", "Directeur de la publication", "Google Cloud EMEA"]) {
      expect(source, `mention manquante: ${mention}`).toContain(mention);
    }
  });
});

describe("CGV en projet", () => {
  const cgv = readPage("cgv.tsx");
  const hasPendingDecisions = (cgv.match(PENDING) ?? []).length > 0;

  it("n'est ni routee ni liee tant que des decisions restent en attente", () => {
    if (!hasPendingDecisions) return; // decisions prises: la page peut etre publiee

    const app = read(path.join(SRC, "App.tsx"));
    const footer = read(path.join(SRC, "components", "layout", "Footer.tsx"));

    expect(app, "CGV routee alors que des clauses sont incompletes").not.toContain('path="/cgv"');
    expect(footer, "CGV liee alors que des clauses sont incompletes").not.toContain('href="/cgv"');
  });

  it("garde la trace des decisions qui restent a prendre", () => {
    // Le projet doit rester explicite sur ce qui manque, sinon il sera publie
    // un jour tel quel.
    expect(cgv).toContain("A FAIRE RELIRE PAR UN CONSEIL");
  });

  it("couvre les clauses qui ne dependent d'aucune decision", () => {
    // Ce qui decoule de la loi est deja redige et ne doit pas disparaitre.
    for (const clause of ["L441-10", "réversibilité", "Droit applicable"]) {
      expect(cgv, `clause manquante: ${clause}`).toMatch(new RegExp(clause, "i"));
    }
  });
});

describe("adresses e-mail publiees", () => {
  /**
   * Une adresse imprimee sur une page legale doit recevoir du courrier. La
   * declaration d'accessibilite et la politique de confidentialite doivent
   * offrir un canal de contact qui FONCTIONNE, et les mentions legales un
   * editeur joignable; une boite sans destination transforme chacune de ces
   * obligations en promesse vide.
   *
   * Le routage se configure dans le tableau de bord Cloudflare, pas ici — ce
   * depot ne peut donc pas prouver qu'une adresse recoit vraiment. Ce qu'il
   * peut garantir, c'est qu'aucune adresse ne soit publiee sans figurer sur la
   * liste a router du README du Worker: c'est precisement l'oubli qui a laisse
   * quatre adresses hors routage.
   */
  const README = path.resolve(
    SRC, "..", "..", "..", "deploy", "cloudflare-email-worker", "README.md",
  );
  const routed = read(README);
  const EMAIL = /[a-zA-Z0-9._-]+@agentdebureau\.fr/g;

  it("figurent toutes sur la liste a router", () => {
    const published = new Set<string>();
    for (const file of fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith(".tsx"))) {
      for (const address of readPage(file).match(EMAIL) ?? []) {
        published.add(address);
      }
    }
    expect(published.size, "aucune adresse trouvee — le scan est casse").toBeGreaterThan(0);

    const missing = [...published].filter((a) => !routed.includes(a));
    expect(
      missing,
      `Adresses publiees mais absentes de la liste a router:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

describe("declaration d'accessibilite", () => {
  const page = readPage("accessibilite.tsx");

  it("annonce l'etat reel sans inventer de taux de conformite", () => {
    // Declarer une conformite non mesuree serait une fausse declaration.
    expect(page).toContain("non conforme");
    expect(page).not.toMatch(/taux de conformité (est|de) \d/);
  });

  it("ouvre une voie de contact et une voie de recours", () => {
    expect(page).toContain("accessibilite@agentdebureau.fr");
    expect(page).toContain("Défenseur des droits");
  });
});
