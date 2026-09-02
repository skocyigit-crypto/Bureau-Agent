import { defineConfig, devices } from "@playwright/test";

/**
 * Tests en navigateur reel.
 *
 * Pourquoi ils manquaient et pourquoi ils comptent ici. Les pannes les plus
 * couteuses de ce produit n'etaient pas visibles a la lecture du code:
 *
 *  - le 14 juillet, le Guardian a ferme le site a TOUS les visiteurs pendant
 *    cinq minutes. Chaque fonction, prise isolement, etait correcte; c'est la
 *    chaine web -> api derriere le proxy qui perdait l'IP reelle. Ce sont des
 *    requetes de navigateur qui l'ont revele, pas une relecture;
 *  - le 2 septembre, les builds ont echoue toute une journee. Le site en ligne
 *    restait l'ancien, sans que rien ne le dise.
 *
 * Un test qui ouvre reellement la page est le seul qui distingue « le code est
 * juste » de « le site s'affiche ».
 *
 * Portee actuelle: le site vitrine. Il se construit et se sert sans base de
 * donnees, donc il tient dans la CI sans montage particulier. L'application
 * authentifiee demande une base amorcee et un compte de test — c'est la suite,
 * et elle merite d'etre faite proprement plutot qu'a moitie.
 */
const PORT = 4321;

export default defineConfig({
  testDir: "./e2e",
  // Un test de fumee lent est un test qu'on finit par ne plus lancer.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // En CI, un echec doit etre un echec: une reprise masquerait justement
  // l'intermittence qu'on cherche a voir.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // `preview` sert le BUILD, pas le serveur de developpement: c'est le
    // fichier reellement deploye qu'on veut voir s'afficher.
    command: `pnpm --filter @workspace/tanitim run build && pnpm --filter @workspace/tanitim exec vite preview --config vite.config.ts --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
