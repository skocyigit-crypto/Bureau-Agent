import { test, expect, type Page } from "@playwright/test";

/**
 * L'application client s'affiche-t-elle vraiment.
 *
 * C'est l'application que les clients ouvrent tous les jours, et jusqu'ici
 * aucune barriere de ce depot n'ouvrait sa page: seul le site vitrine etait
 * couvert. Or la panne la plus couteuse de ce produit n'est pas une regression
 * de logique, c'est une page blanche — un bundle casse, une route qui ne monte
 * plus, un asset absent. Le typage et les tests unitaires restent verts pendant
 * ce temps-la.
 *
 * Portee: l'ecran de connexion, servi par le BUILD de production. Il se rend
 * sans base de donnees et sans API, ce qui le rend testable en CI sans montage
 * particulier. Les parcours authentifies (tableau de bord, facturation)
 * demandent une base amorcee et un compte de test: c'est la suite.
 *
 * Ce que ces tests n'affirment PAS: l'absence d'erreurs console. Sans API
 * derriere, les appels reseau de la page repondent 500, et l'exiger ici
 * rendrait le test faux plutot que strict. On verifie donc les erreurs qui
 * signalent un bundle casse, pas celles qui signalent une API absente.
 */

/** Erreurs de chargement de modules/scripts — le symptome d'un bundle casse. */
function collectScriptErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Les 500 proviennent de l'API absente en CI, pas de l'application.
    if (/status of 5\d\d/i.test(text)) return;
    if (/Failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

/** Texte visible de la page, normalise. */
async function bodyText(page: Page): Promise<string> {
  const text = await page.locator("body").innerText();
  return text.replace(/\s+/g, " ").trim();
}

test.describe("ecran de connexion", () => {
  test("se rend avec son formulaire, pas une page blanche", async ({ page }) => {
    const errors = collectScriptErrors(page);

    const response = await page.goto("/");
    expect(response?.status(), "la page doit etre servie").toBeLessThan(400);

    // Le formulaire lui-meme: sans lui, personne n'entre dans le produit. On
    // l'attend au lieu de lire le DOM tout de suite: `goto` rend la main sur
    // l'evenement "load", donc pendant que React monte encore et affiche son
    // ecran "Chargement...". Lire a cet instant mesurerait la vitesse de la
    // machine, pas l'application.
    await expect(page.locator("input[type=email], input[name=email]")).toHaveCount(1);
    await expect(page.locator("input[type=password]")).toHaveCount(1);

    // Une coquille React qui ne monte jamais laisse un <body> quasi vide tout
    // en repondant 200: c'est exactement le cas que ce test doit distinguer.
    const text = await bodyText(page);
    expect(text.length, `page quasi vide: ${JSON.stringify(text)}`).toBeGreaterThan(80);

    expect(errors, `erreurs de script: ${errors.join(" | ")}`).toEqual([]);
  });

  test("une route inconnue rend l'application, pas une erreur du serveur", async ({ page }) => {
    // L'application est une SPA: toute route doit retomber sur index.html.
    // Une mauvaise configuration de service statique renvoie ici un 404 brut,
    // et l'utilisateur qui recharge une page interne se retrouve dehors.
    const response = await page.goto("/une-route-qui-nexiste-pas");
    expect(response?.status(), "le repli SPA doit servir l'application").toBeLessThan(400);

    // Meme raison qu'au-dessus: on laisse l'application finir de monter.
    await expect.poll(async () => (await bodyText(page)).length).toBeGreaterThan(80);
  });

  test("se rend sans violer la politique de securite du contenu", async ({ page }) => {
    // Le serveur de test applique deploy/csp.policy en mode BLOQUANT (en
    // production elle est encore Report-Only, voir deploy/csp.policy.md). Une
    // violation ici, c'est un script ou un gestionnaire en ligne reintroduit
    // dans le document — exactement ce qui empechait d'activer cette politique
    // avant le 2026-09-03, et ce qui la rendrait a nouveau impossible.
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        const bag = ((window as unknown as Record<string, unknown>).__csp ??= []) as string[];
        bag.push(`${event.effectiveDirective} <- ${event.blockedURI}`);
      });
    });

    await page.goto("/");
    await expect(page.locator("input[type=password]")).toHaveCount(1);

    const violations = await page.evaluate(
      () => ((window as unknown as Record<string, unknown>).__csp as string[]) ?? [],
    );
    expect(violations, `violations CSP: ${violations.join(" | ")}`).toEqual([]);
  });

  test("sert son manifeste PWA", async ({ page }) => {
    // L'application est installable; un manifeste absent du build casse
    // l'installation sans rien casser d'autre de visible. Le repli SPA sert
    // index.html pour tout chemin inconnu, donc un manifeste disparu
    // repondrait quand meme 200: c'est le parsing JSON qui fait la difference.
    const response = await page.request.get("/manifest.json");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.name ?? manifest.short_name).toBeTruthy();
  });
});
