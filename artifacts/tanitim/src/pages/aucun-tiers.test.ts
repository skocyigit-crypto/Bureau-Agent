/**
 * Ce que le site promet aux visiteurs: aucune ressource tierce.
 *
 * Le bandeau et la politique de confidentialite affirment qu'aucun traceur ni
 * service tiers n'est utilise. C'etait faux d'un cheveu, mais d'un cheveu qui
 * compte: la police Inter etait chargee depuis `fonts.googleapis.com` et
 * `fonts.gstatic.com`. Une police n'est pas un cookie — mais la requete
 * transmet l'adresse IP du visiteur a Google, avant meme l'affichage du
 * bandeau, et le tribunal regional de Munich (LG Munchen I, 3 O 17493/20) a
 * juge ce seul appel suffisant pour caracteriser une atteinte.
 *
 * La police est desormais empaquetee avec l'application. Ce test empeche la
 * regression, parce qu'un `<link>` vers un CDN se rajoute en une ligne, sans
 * que rien n'echoue et sans que personne ne le remarque.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = path.resolve(__dirname, "../../..");

/**
 * Hotes tiers dont un appel depuis la page revele l'adresse IP du visiteur.
 * La liste couvre ce qui se glisse le plus facilement dans un `index.html`:
 * polices, bibliotheques servies par CDN, analytique.
 */
const HOTES_TIERS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "ajax.googleapis.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "google-analytics.com",
  "googletagmanager.com",
  "connect.facebook.net",
];

const PAGES = [
  "tanitim/index.html",
  "buro-ajani/index.html",
];

describe("aucune ressource chargee depuis un tiers", () => {
  for (const page of PAGES) {
    it(`${page} ne demande rien a un service tiers`, () => {
      const fichier = path.join(RACINE, page);
      const html = fs.readFileSync(fichier, "utf8");

      // On ne regarde que ce qui declenche une requete — `href`, `src`,
      // `content` d'une balise. Un commentaire qui NOMME un hote (pour
      // expliquer pourquoi on ne l'appelle plus) n'en declenche aucune.
      const sansCommentaires = html.replace(/<!--[^]*?-->/g, "");

      for (const hote of HOTES_TIERS) {
        expect(
          sansCommentaires.includes(hote),
          `${page} appelle ${hote}: l'adresse IP du visiteur lui est transmise, ` +
          "alors que le bandeau et la politique de confidentialite annoncent l'absence de tiers",
        ).toBe(false);
      }
    });
  }

  it("la police est bien empaquetee, pas simplement retiree", () => {
    // Retirer le lien sans fournir la police laisserait le site en police
    // systeme: le defaut serait « corrige » et le rendu casse.
    const main = fs.readFileSync(path.join(RACINE, "tanitim/src/main.tsx"), "utf8");
    expect(main).toContain("@fontsource/inter");

    const pkg = JSON.parse(
      fs.readFileSync(path.join(RACINE, "tanitim/package.json"), "utf8"),
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps["@fontsource/inter"], "la police doit etre une dependance declaree").toBeTruthy();
  });
});

/**
 * Le code QR de la section « Ajant Bureau sur votre telephone ».
 *
 * La facon la plus rapide d'afficher un QR est d'appeler un service qui le
 * dessine — `api.qrserver.com`, `chart.googleapis.com`, `quickchart.io`. Cela
 * transmettrait a ce service l'adresse IP de chaque visiteur ET l'adresse
 * encodee, sur la page d'accueil, avant tout consentement: exactement la fuite
 * que ce site vient de fermer avec la police.
 *
 * Le QR est donc un fichier genere hors ligne et servi par nous. Ces tests
 * empechent le retour en arriere, qui tiendrait en une ligne.
 */
const SERVICES_QR = [
  "api.qrserver.com",
  "chart.googleapis.com",
  "quickchart.io",
  "goqr.me",
];

describe("code QR de l'installation mobile", () => {
  const composant = fs.readFileSync(
    path.join(RACINE, "tanitim/src/components/MobileInstall.tsx"),
    "utf8",
  );

  it("n'est dessine par aucun service tiers", () => {
    const sansCommentaires = composant.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n\r]*/g, "");
    for (const service of SERVICES_QR) {
      expect(
        sansCommentaires.includes(service),
        `le QR est demande a ${service}: adresse IP du visiteur transmise a un tiers`,
      ).toBe(false);
    }
  });

  it("est servi depuis notre domaine, et le fichier existe", () => {
    expect(composant).toContain('src="/qr-application.svg"');
    // Un `<img>` vers un fichier absent ne fait echouer aucun test de rendu:
    // la page s'affiche, avec un cadre vide a la place du QR.
    const svg = path.join(RACINE, "tanitim/public/qr-application.svg");
    expect(fs.existsSync(svg), "le fichier du QR est absent de public/").toBe(true);
    expect(fs.readFileSync(svg, "utf8")).toContain("<svg");
  });

  it("annonce l'installation depuis le navigateur, pas un magasin", () => {
    // L'application native n'est publiee sur aucun magasin: elle demande un
    // compte Apple Developer et un compte Play Console, tous deux au nom du
    // proprietaire. Afficher des boutons « App Store » / « Google Play »
    // promettrait un telechargement qui n'existe pas.
    expect(composant).not.toMatch(/apps\.apple\.com|play\.google\.com/);
    const aplati = composant.replace(/\s+/g, " ");
    expect(
      aplati,
      "la section doit dire que l'application n'est pas encore sur les magasins",
    ).toMatch(/pas encore publi[ée]e sur l'App Store/i);
  });
});
