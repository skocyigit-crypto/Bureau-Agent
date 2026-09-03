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

## Etat: `Report-Only`, pas encore bloquante

Mesure faite le 2026-09-03 sur le build de production reel, servi avec cette
politique appliquee: **zero violation**, page identique. Deux violations
existaient avant et ont ete corrigees a la source (un `<script>` en ligne et un
`onload="this.media='all'"`, tous deux deplaces dans
`src/bootstrap-document.ts`).

Cette mesure ne couvre cependant que l'**ecran de connexion**: sans base de
donnees ni API, aucun parcours authentifie n'a pu etre ouvert. Une CSP fausse
sur une page interne n'afficherait pas un defaut discret — elle casserait la
page pour un client qui paie. D'ou `Content-Security-Policy-Report-Only`: le
navigateur signale sans bloquer.

## Condition pour la rendre bloquante

Ouvrir, avec la console, les parcours qui sortent de l'ordinaire — paiement
Stripe, connexion Google, televersement de documents, VoiceLive — et verifier
qu'aucune violation n'est signalee. Renommer alors le header en
`Content-Security-Policy` dans les deux Caddyfile. Attention en particulier a
`frame-src 'none'`: si un tunnel de paiement passe par une iframe et non par
une redirection, il faudra l'autoriser explicitement.
