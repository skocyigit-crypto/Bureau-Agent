#!/usr/bin/env bash
#
# Empeche un ancien commit d'ecraser un plus recent deja en production.
#
# Le defaut observe le 11/09/2026: le build de 57a4b87 (cree a 10:23) a fini a
# 10:48 et a deploye; celui de f92100f (cree a 10:08, donc PLUS ANCIEN) a fini
# a 10:55 et a deploye par-dessus. La production est restee cinq heures sur le
# commit precedent, sans qu'aucune alerte ne se declenche: les deux builds
# etaient verts, et ils avaient raison de l'etre — chacun avait fait son
# travail. C'est l'ORDRE qui etait faux.
#
# Le critere n'est ni l'heure de creation du build ni celle de fin: une file
# d'attente peut inverser les deux. Le seul ordre qui ne ment pas est celui des
# commits. Si ce que nous nous appretons a deployer est un ANCETRE de ce qui
# tourne deja, nous reculerions: on s'abstient.
#
# Usage:  garde-ordre-deploiement.sh <notre_sha> <sha_deploye>
# Sortie: 0  -> deployer
#         10 -> s'abstenir, la production est deja plus avancee
#
# TOUTE incertitude rend 0. Une garde qui doute doit laisser passer: le pire
# cas d'un faux « deployer » est un redeploiement inutile, celui d'un faux
# « s'abstenir » est une correction qui n'arrive jamais en production. Les deux
# ne se valent pas.
set -u

notre="${1:-}"
deploye="${2:-}"

# Rien en face: premiere mise en service, ou variable absente.
if [ -z "$notre" ] || [ -z "$deploye" ]; then
  echo "garde: aucun repere en production (notre='$notre' deploye='$deploye') -> deployer"
  exit 0
fi

if [ "$notre" = "$deploye" ]; then
  echo "garde: meme commit que la production ($notre) -> deployer (redeploiement sans effet de bord)"
  exit 0
fi

if ! command -v git >/dev/null 2>&1 || ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "garde: pas d'historique git ici, impossible de comparer -> deployer"
  exit 0
fi

# Les deux commits doivent etre connus. Un build lance sur une archive sans
# historique complet, ou un SHA tronque d'une longueur inhabituelle, ne doit
# pas bloquer le deploiement.
if ! git cat-file -e "${notre}^{commit}" 2>/dev/null || ! git cat-file -e "${deploye}^{commit}" 2>/dev/null; then
  echo "garde: commit inconnu de cet historique -> deployer"
  exit 0
fi

if git merge-base --is-ancestor "$notre" "$deploye" 2>/dev/null; then
  echo "garde: $notre est un ANCETRE de $deploye deja en production -> s'abstenir"
  echo "garde: ce build n'est pas en echec, il est simplement depasse."
  exit 10
fi

echo "garde: $notre n'est pas derriere $deploye -> deployer"
exit 0
