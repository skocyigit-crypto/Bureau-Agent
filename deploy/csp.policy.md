# Politique de securite du contenu (CSP) — document de l'application

`csp.policy` contient **la** politique, sur une seule ligne. Elle est la source
unique: les Caddyfile la recopient telle quelle et un test
(`artifacts/buro-ajani/src/test/csp-policy.test.ts`) verifie qu'aucune copie
n'a derive.

## Ou elle s'applique, et pourquoi cela comptait

Elle protege le **document** de l'application — la page qui execute le
JavaScript. Jusqu'au 2026-09-03, `app.agentdebureau.fr` n'en renvoyait aucune:
la seule CSP en ligne etait celle posee par helmet sur les reponses JSON de
`/api`, ou elle ne gouverne quasiment rien. La politique ci-dessous existait
pourtant deja, ecrite pour cette application — mais dans
`deploy/non-docker/nginx.conf`, une cible d'auto-hebergement qui ne tourne pas.

## Etat: BLOQUANTE depuis le 2026-09-12

Pendant soixante jours, la politique a ete servie en `Report-Only`: le
navigateur signalait sans bloquer, et chaque violation partait vers
`/api/csp-report`. C'est cette periode qui a permis de DECIDER plutot que de
supposer.

**Ce qu'elle a montre: onze violations en tout.**

| combien | ce que c'etait |
| --- | --- |
| 10 | un defaut a nous: une adresse construite en `//api/...`, que le navigateur lit comme l'hote `api`. Corrige. |
| 1 | une feuille de style injectee par la traduction automatique du navigateur — elle ne vient pas de notre page. |

L'observation a donc surtout servi a trouver un defaut du PRODUIT: deux
panneaux du tableau de bord n'appelaient rien, et rien d'autre ne le signalait.
Une politique en mode observation n'est pas seulement une etape avant de
bloquer, c'est aussi un temoin — a condition d'aller lire ce qu'elle raconte,
ce que personne n'avait fait pendant deux mois.

## Les parcours inhabituels, verifies un par un

Ils ont ete regardes dans le code plutot que supposes, parce que le paiement
n'a jamais tourne en production — les cles Stripe ne sont pas encore posees —
et que soixante jours d'observation ne pouvaient donc rien en dire:

- **paiement Stripe**: REDIRECTION (`window.location` vers
  `checkout.stripe.com`), pas d'iframe. `frame-src 'none'` ne le gene donc pas,
  et `form-action` autorise deja les deux domaines Stripe;
- **connexion Google**: redirection egalement, `accounts.google.com` deja
  autorise par `form-action`;
- **televersement** et **VoiceLive**: meme origine, couverte par
  `connect-src 'self'` — WebSocket compris, la connexion se faisant vers
  `window.location.host`.

C'est la seule partie qui repose sur une lecture du code et non sur une mesure.
Si le tunnel de paiement passait un jour par une iframe, il faudrait autoriser
`frame-src https://checkout.stripe.com` AVANT de l'activer.

## Ce qui est perdu, assume

La feuille de style de la traduction automatique du navigateur sera bloquee.
C'est cosmetique, sur une page traduite par la machine, dans une application
qui embarque ses propres traductions FR/TR/EN. Ajouter un hote tiers a la
politique qui protege des donnees bancaires, pour ce seul cas, serait un
mauvais echange.

`report-uri` est conserve: bloquer et continuer a apprendre ne s'excluent pas.
La prochaine violation signalee vaudra la peine d'etre lue plus vite que
celle-ci.

## Si une page casse

Le retour arriere est immediat et tient en un mot: renommer l'en-tete en
`Content-Security-Policy-Report-Only` dans les deux Caddyfile. La politique
redevient un temoin sans rien bloquer, le temps de comprendre.
