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
# 18/09/2026 — la meme chose est arrivee MALGRE cette garde: #207 (11b8bbc) est
# parti en production a 09:55, puis le build de #206 (0e1357d, plus ancien) a
# fini a 10:03 et a deploye par-dessus. La garde n'avait pas failli a son
# raisonnement: Cloud Build clone en profondeur 1, le commit d'en face lui
# etait INCONNU, et par principe une garde qui doute laisse passer. Le doute
# etait donc structurel, pas accidentel — il se reproduirait a chaque fois.
#
# D'ou un second critere, utilise UNIQUEMENT quand git ne peut pas repondre: la
# date du commit, qui voyage avec le build (BUILD_COMMIT_TIME, publiee par
# /api/healthz) et ne demande aucun historique. Elle ne remplace pas
# l'ascendance — deux commits peuvent porter la meme seconde, et une date seule
# ne dit rien d'un lien de parente — mais « strictement plus ancien » suffit a
# reconnaitre un build depasse.
#
# Usage:  garde-ordre-deploiement.sh <notre_sha> <sha_deploye> [notre_date] [date_deployee]
#         dates: secondes Unix du commit (git show -s --format=%ct).
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
notre_date="${3:-}"
deploye_date="${4:-}"

# Vrai (0) si les deux dates sont exploitables ET que la notre est strictement
# plus ancienne. Tout le reste rend 1: pas de date, date non numerique, egalite,
# ou nous sommes plus recents.
depasse_selon_les_dates() {
  [ -n "$notre_date" ] && [ -n "$deploye_date" ] || return 1
  case "$notre_date" in ''|*[!0-9]*) return 1 ;; esac
  case "$deploye_date" in ''|*[!0-9]*) return 1 ;; esac
  if [ "$notre_date" -lt "$deploye_date" ]; then
    echo "garde: notre commit date de $notre_date, la production de $deploye_date -> s'abstenir"
    echo "garde: ce build n'est pas en echec, il est simplement depasse."
    return 0
  fi
  return 1
}

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
  if depasse_selon_les_dates; then exit 10; fi
  echo "garde: pas d'historique git ici, et pas de date exploitable -> deployer"
  exit 0
fi

# Les deux commits doivent etre connus. Un build lance sur une archive sans
# historique complet (Cloud Build clone en profondeur 1), ou un SHA tronque
# d'une longueur inhabituelle, ne doit pas bloquer le deploiement — mais la
# date, si elle est disponible, tranche avant qu'on renonce.
if ! git cat-file -e "${notre}^{commit}" 2>/dev/null || ! git cat-file -e "${deploye}^{commit}" 2>/dev/null; then
  if depasse_selon_les_dates; then exit 10; fi
  echo "garde: commit inconnu de cet historique, et pas de date exploitable -> deployer"
  exit 0
fi

if git merge-base --is-ancestor "$notre" "$deploye" 2>/dev/null; then
  echo "garde: $notre est un ANCETRE de $deploye deja en production -> s'abstenir"
  echo "garde: ce build n'est pas en echec, il est simplement depasse."
  exit 10
fi

echo "garde: $notre n'est pas derriere $deploye -> deployer"
exit 0
