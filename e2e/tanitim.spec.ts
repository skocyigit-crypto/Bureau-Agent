import { test, expect, type Page } from "@playwright/test";

/**
 * Le site vitrine s'affiche-t-il vraiment.
 *
 * Ces tests ne verifient pas une logique: ils verifient qu'une page demandee
 * par un navigateur arrive, se rend, et ne se rend pas vide. C'est precisement
 * ce qu'aucune autre barriere de ce depot ne sait faire — le typage, les 869
 * tests unitaires et l'inventaire des routes peuvent tous etre verts pendant
 * que le site affiche une page blanche ou refuse ses visiteurs.
 *
 * Les mentions legales, les CGU/CGV et la page d'accessibilite ne sont pas du
 * contenu ordinaire: ce sont des obligations. Une page vide ou en 404 les rend
 * inopposables, et cela ne casse rien de detectable autrement.
 */

/** Erreurs de console collectees pendant la navigation. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/**
 * Violations de la politique de securite du contenu.
 *
 * Elles sont recueillies separement des erreurs ordinaires parce qu'elles ne
 * se voient pas de la meme facon: une ressource bloquee par la CSP ne fait pas
 * planter la page — elle la prive silencieusement d'une feuille de style,
 * d'une image ou d'un appel reseau. Le visiteur voit une page qui « marche »,
 * en moins bien, et personne ne l'apprend.
 */
function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const texte = msg.text();
    if (/Content Security Policy|Content-Security-Policy/i.test(texte)) violations.push(texte);
  });
  return violations;
}

test.describe("page d'accueil", () => {
  test("se rend avec du contenu, pas une page blanche", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const violations = collectCspViolations(page);
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    // Les donnees structurees (JSON-LD) sont des blocs de DONNEES, que
    // `script-src` ne gouverne pas. On le verifie plutot que de le supposer:
    // une CSP qui les bloquerait ne se verrait pas — la page s'afficherait
    // normalement et le referencement se degraderait en silence.
    expect(violations, `violations CSP sur l'accueil: ${violations.join(" | ")}`).toEqual([]);
    // Une application React cassee rend un <div id="root"> vide et un 200
    // parfaitement convaincant. On regarde donc le contenu, pas le statut.
    await expect(page.locator("body")).toContainText(/\w{4,}/);
    const text = await page.locator("body").innerText();
    expect(text.trim().length).toBeGreaterThan(200);

    // Une erreur au premier rendu casse en general tout ce qui suit.
    expect(errors, `Erreurs console: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("porte un titre et une description, sans quoi elle est invisible", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.{10,}/);
    const description = page.locator('meta[name="description"]');
    await expect(description).toHaveAttribute("content", /.{30,}/);
  });

  test("a exactement un titre de niveau 1", async ({ page }) => {
    // Exigence d'accessibilite et de referencement: zero h1 laisse la page sans
    // titre pour un lecteur d'ecran, plusieurs la rendent ambigue.
    await page.goto("/");
    await expect(page.locator("h1")).toHaveCount(1);
  });
});

test.describe("pages obligatoires", () => {
  // Une page legale absente ou vide n'est pas un defaut d'affichage: elle rend
  // les conditions inopposables. Rien d'autre dans ce depot ne le verifierait.
  // Chaque page porte le titre qu'on attend d'elle. Ce n'est pas cosmetique:
  // c'est la SEULE chose qui distingue la vraie page de la page d'erreur.
  const pages = [
    { path: "/mentions-legales", label: "mentions legales", titre: /mentions l[ée]gales/i },
    { path: "/confidentialite", label: "politique de confidentialite", titre: /confidentialit[ée]/i },
    // La version turque de la politique de confidentialite. Elle etait dans le
    // routeur mais absente de cette liste — donc la seule page legale dont
    // rien ne prouvait qu'elle s'affiche. L'interface entiere est traduite en
    // turc: une politique de confidentialite muette pour ces utilisateurs les
    // laisse sans le document que le RGPD leur destine.
    { path: "/gizlilik", label: "politique de confidentialite (turc)", titre: /gizlilik politikas/i },
    { path: "/cgu", label: "conditions d'utilisation", titre: /conditions g[ée]n[ée]rales d'utilisation/i },
    // Publiee le 2026-09-03: vendre un abonnement sans CGV laisse le prix, la
    // duree, la resiliation et la responsabilite sans cadre contractuel.
    { path: "/cgv", label: "conditions de vente", titre: /conditions g[ée]n[ée]rales de vente/i },
    { path: "/dpa", label: "accord de sous-traitance", titre: /sous-traitance/i },
    { path: "/accessibilite", label: "declaration d'accessibilite", titre: /d[ée]claration d'accessibilit[ée]/i },
  ];

  for (const { path, label, titre } of pages) {
    test(`${label} : accessible et non vide`, async ({ page }) => {
      const violations = collectCspViolations(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      // La politique s'applique a CHAQUE page, pas seulement a l'accueil: ces
      // pages sont chargees a la demande, donc chacune demande son propre
      // morceau de JavaScript.
      expect(violations, `violations CSP sur ${path}`).toEqual([]);

      // Ces pages sont chargees a la demande (`lazy()`), derriere un Suspense
      // dont le repli est un div vide. Lire le texte juste apres `goto` ne
      // mesurait donc que la banniere cookies — 223 caracteres, et quatre
      // echecs qui ressemblaient a des pages legales vides. On attend le titre,
      // ce qui verifie au passage que le morceau charge vraiment.
      const h1 = page.locator("h1").first();
      await expect(h1).toBeVisible();

      // Le titre attendu, et pas seulement « un titre ».
      //
      // Mesure faite le 2026-09-03 contre la production, avant que /cgv et
      // /dpa n'y soient deployees: les six tests passaient DEJA, alors que
      // deux des pages n'existaient pas encore en ligne. C'est une
      // application monopage — une adresse inconnue rend HTTP 200, affiche un
      // `<h1>` (« Page introuvable ») et pese 333 caracteres, soit juste
      // au-dessus du seuil de 300. Les trois assertions precedentes etaient
      // donc vraies pour N'IMPORTE QUELLE adresse.
      //
      // Le test existait precisement pour attraper une page legale absente —
      // « rien d'autre dans ce depot ne le verifierait » — et c'etait le seul
      // cas qu'il ne pouvait pas voir. Un test toujours vert est pire qu'un
      // test absent: il tient lieu de preuve.
      await expect(h1, `${path} ne rend pas la page attendue`).toHaveText(titre);

      const text = await page.locator("main, body").first().innerText();
      expect(text.trim().length, `${path} semble vide`).toBeGreaterThan(300);
    });
  }
});

test.describe("navigation", () => {
  test("le pied de page mene aux pages legales", async ({ page }) => {
    await page.goto("/");
    const legalLink = page.locator('a[href="/mentions-legales"]').first();
    await expect(legalLink).toBeVisible();
    await legalLink.click();
    await expect(page).toHaveURL(/mentions-legales/);
    // Attendre le titre, pas « du texte »: la banniere cookies suffisait a
    // satisfaire une assertion aussi large, et le test passait au vert sur une
    // page qui n'avait rien rendu.
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("une adresse inconnue rend une page 404 utilisable", async ({ page }) => {
    // Une SPA rend un 200 sur tout: ce qui compte est que le visiteur
    // comprenne, et puisse repartir.
    await page.goto("/cette-page-n-existe-pas");
    const text = await page.locator("body").innerText();
    expect(text.trim().length).toBeGreaterThan(20);
    await expect(page.locator('a[href="/"]').first()).toBeVisible();
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("l'accueil ne deborde pas horizontalement", async ({ page }) => {
    await page.goto("/");
    // Un debordement horizontal sur telephone rend la page difficile a lire et
    // passe inapercu sur un ecran de developpeur.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "la page deborde horizontalement sur mobile").toBeLessThanOrEqual(1);
  });
});
