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
 * Portee actuelle: le site vitrine ET l'ecran de connexion de l'application
 * client. Tous deux se construisent et se servent sans base de donnees, donc
 * ils tiennent dans la CI sans montage particulier. Les parcours authentifies
 * (tableau de bord, facturation) demandent une base amorcee et un compte de
 * test — c'est la suite, et elle merite d'etre faite proprement plutot qu'a
 * moitie.
 */
const VITRINE_PORT = 4321;
const APP_PORT = 4322;

/**
 * Viser un site DEJA en ligne plutot que le build local.
 *
 * Le commentaire ci-dessus rappelle la panne du 2 septembre: les builds ont
 * echoue toute une journee et « le site en ligne restait l'ancien, sans que
 * rien ne le dise ». Cette suite ne pouvait pourtant pas le dire non plus —
 * elle construisait sa propre copie et la servait en local, donc elle
 * affirmait « le code est juste », jamais « c'est bien ce code qui est
 * servi ».
 *
 * Avec ces deux variables, le meme test s'execute contre la production:
 *
 *   VITRINE_BASE_URL=https://agentdebureau.fr npx playwright test --project=vitrine
 *
 * Les serveurs locaux ne sont alors pas demarres — les lancer construirait
 * pendant plusieurs minutes une copie que personne ne regarde, et surtout
 * cela laisserait croire qu'un echec vient du build local.
 */
const VITRINE_URL = process.env.VITRINE_BASE_URL || `http://127.0.0.1:${VITRINE_PORT}`;
const APP_URL = process.env.APP_BASE_URL || `http://127.0.0.1:${APP_PORT}`;
const VITRINE_IS_REMOTE = Boolean(process.env.VITRINE_BASE_URL);
const APP_IS_REMOTE = Boolean(process.env.APP_BASE_URL);

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
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // Deux serveurs, donc deux projets: chacun porte son propre baseURL, et un
  // fichier de test ne peut pas viser le mauvais site par accident.
  projects: [
    {
      name: "vitrine",
      testMatch: /tanitim.spec.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: VITRINE_URL },
    },
    {
      name: "application",
      testMatch: /app-shell.spec.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
    },
  ],
  // Un site distant se sert lui-meme: on ne demarre que les serveurs encore
  // utiles. Construire une copie que personne ne regarde couterait plusieurs
  // minutes, et ferait surtout passer un echec du site en ligne pour un
  // echec du build local.
  webServer: [
    {
      // Le BUILD, pas le serveur de developpement: c'est le fichier reellement
      // deploye qu'on veut voir s'afficher.
      //
      // Pas `vite preview` non plus, pour la meme raison que du cote
      // application: le preview sert le build NU, sans aucun des en-tetes que
      // Caddy pose en production. `serve-tanitim.mjs` applique la vraie CSP
      // (deploy/csp.tanitim.policy), ce qui permet au test d'affirmer que la
      // politique n'empeche aucune page de s'afficher — les pages legales
      // comprises.
      command: `pnpm --filter @workspace/tanitim run build && node e2e/serve-tanitim.mjs`,
      env: { PORT: String(VITRINE_PORT) },
      url: `http://127.0.0.1:${VITRINE_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // Sans API derriere: l'ecran de connexion se rend quand meme, et c'est
      // precisement ce qu'on veut pouvoir affirmer.
      //
      // Pas `vite preview`, mais e2e/serve-app.mjs: le preview sert le build
      // nu, sans aucun des en-tetes que Caddy pose en production. Ce petit
      // serveur applique la vraie CSP (deploy/csp.policy), ce qui permet au
      // test d'affirmer que la politique n'empeche pas la page de s'afficher.
      command: `pnpm --filter @workspace/buro-ajani run build && node e2e/serve-app.mjs`,
      env: { PORT: String(APP_PORT) },
      url: `http://127.0.0.1:${APP_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ].filter((_, index) => (index === 0 ? !VITRINE_IS_REMOTE : !APP_IS_REMOTE)),
});
