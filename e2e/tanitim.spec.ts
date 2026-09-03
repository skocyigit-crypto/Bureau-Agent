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

test.describe("page d'accueil", () => {
  test("se rend avec du contenu, pas une page blanche", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
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
  const pages = [
    { path: "/mentions-legales", label: "mentions legales" },
    { path: "/confidentialite", label: "politique de confidentialite" },
    { path: "/cgu", label: "conditions d'utilisation" },
    // Publiee le 2026-09-03: vendre un abonnement sans CGV laisse le prix, la
    // duree, la resiliation et la responsabilite sans cadre contractuel.
    { path: "/cgv", label: "conditions de vente" },
    { path: "/dpa", label: "accord de sous-traitance" },
    { path: "/accessibilite", label: "declaration d'accessibilite" },
  ];

  for (const { path, label } of pages) {
    test(`${label} : accessible et non vide`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      // Ces pages sont chargees a la demande (`lazy()`), derriere un Suspense
      // dont le repli est un div vide. Lire le texte juste apres `goto` ne
      // mesurait donc que la banniere cookies — 223 caracteres, et quatre
      // echecs qui ressemblaient a des pages legales vides. On attend le titre,
      // ce qui verifie au passage que le morceau charge vraiment.
      await expect(page.locator("h1").first()).toBeVisible();

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
