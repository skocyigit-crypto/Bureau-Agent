# Politique de securite du contenu — site vitrine

`csp.tanitim.policy` contient **la** politique du site public, sur une seule
ligne. Elle est la source unique: `deploy/Caddyfile.tanitim.cloudrun` la
recopie, `e2e/serve-tanitim.mjs` la sert aux tests en navigateur, et un test
verifie qu'aucune copie n'a derive.

## Ce qu'elle corrige

Mesure du 2026-09-05 sur `https://agentdebureau.fr/`: la reponse portait
`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options` et
`Referrer-Policy` — mais **ni CSP ni Permissions-Policy**. L'application, elle,
avait les deux. Or c'est le site vitrine qui sert la racine du domaine: le seul
document qu'un visiteur, un moteur de recherche ou le questionnaire de securite
d'un acheteur regarde en premier n'etait pas couvert.

## Pourquoi elle est BLOQUANTE ici, alors qu'elle est Report-Only pour l'application

Ce n'est pas une inconstance, c'est une difference de ce qu'on peut prouver.

L'application a des parcours qu'aucun test local n'ouvre sans base de donnees
ni compte — paiement, connexion Google, televersement, VoiceLive. Une CSP fausse
y casserait la page d'un client qui paie, sans avertissement prealable. D'ou
`Report-Only` (voir `csp.policy.md`).

Le site vitrine n'a rien de tel: il est statique, ses ressources sont toutes
locales et enumerables, et `e2e/tanitim.spec.ts` ouvre reellement chacune de
ses pages, y compris les pages legales, avec cette politique appliquee en mode
bloquant. Ce qui est verifie en entier peut etre applique en entier.

## Differences avec la politique de l'application

- `form-action 'self'`: le site vitrine n'envoie aucun formulaire vers Stripe
  ou Google. Autoriser des destinations qu'il n'utilise pas serait elargir la
  politique sans raison.
- pas de `blob:` dans `img-src`: rien n'y construit d'image en memoire.

## Note sur les donnees structurees

Les deux blocs `<script type="application/ld+json">` de `index.html` ne sont
pas concernes par `script-src`: ce sont des blocs de DONNEES, que le navigateur
n'execute pas. Le test le confirme en ouvrant la page — plutot que de le
supposer, car une politique qui casserait les donnees structurees ne se verrait
pas a l'oeil: le site s'afficherait normalement et le referencement se
degraderait en silence.
