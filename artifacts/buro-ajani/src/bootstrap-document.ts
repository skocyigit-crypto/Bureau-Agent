/**
 * Les deux gestes que le document HTML faisait lui-meme, en ligne.
 *
 * Ils vivaient dans `index.html`: un `<script>` en ligne pour enregistrer le
 * service worker, et un `onload="this.media='all'"` sur la feuille de style des
 * polices. Les deux fonctionnaient, mais ils interdisaient une politique de
 * securite du contenu (CSP) stricte sur le document de l'application: il aurait
 * fallu ouvrir `script-src` a `unsafe-inline`, c'est-a-dire renoncer a la
 * protection que la CSP apporte precisement contre l'injection de script.
 *
 * Deplaces ici, ils s'executent depuis le bundle — une source `self`, donc
 * autorisee sans exception. Mesure faite sur le build reel: le document passe
 * alors de deux violations a zero.
 */

import { recoverFromChunkError } from "@/lib/chunk-recovery";

/** Enregistre le service worker, sans jamais faire echouer le demarrage. */
function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

/**
 * Active les feuilles de style chargees en differe.
 *
 * Le motif est classique: la feuille est declaree `media="print"` pour que le
 * navigateur la telecharge sans bloquer le rendu, puis on la bascule sur
 * `all` une fois prete. C'est cette bascule qui se faisait en `onload` inline.
 */
function activateDeferredStyles(): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>("link[data-async-style]")) {
    if (link.media !== "all") link.media = "all";
  }
}

/**
 * Rattrape l'echec de chargement d'un morceau de code AVANT qu'il ne devienne
 * une erreur React.
 *
 * Vite emet `vite:preloadError` quand le fichier d'une page chargee
 * paresseusement ne peut pas etre recupere — le cas exact d'un deploiement qui
 * a supprime l'ancien fichier. Pris ici, l'utilisateur ne voit jamais l'ecran
 * « rechargez ou reessayez »: la page se recharge et s'ouvre. La frontiere
 * d'erreur garde le meme rattrapage, pour les navigateurs ou l'echec passe
 * autrement.
 */
function recoverFromStalePageChunks(): void {
  window.addEventListener("vite:preloadError", (event) => {
    // Empeche Vite de relancer l'erreur: on s'en occupe.
    event.preventDefault();
    recoverFromChunkError();
  });
}

export function bootstrapDocument(): void {
  activateDeferredStyles();
  registerServiceWorker();
  recoverFromStalePageChunks();
}
