#!/usr/bin/env bash
#
# Deploiement canari : la nouvelle revision ne recoit du trafic QU'APRES avoir
# prouve qu'elle repond.
#
# Avant (17/09/2026) : `gcloud run deploy` basculait 100 % du trafic sur la
# nouvelle revision des qu'elle demarrait. Une revision qui demarre mais repond
# mal (base injoignable, mauvais build, route cassee) servait les clients avant
# que quiconque le sache ; « bitti » se lisait sur un buildHash, pas sur un
# service qui fonctionne.
#
# Maintenant :
#   1. deploiement SANS trafic, sous l'etiquette `candidat` ;
#   2. sonde de l'URL etiquetee (https://candidat---<hote du service>) : le corps
#      doit contenir ce que la revision doit prouver (build attendu, base connectee) ;
#   3. seulement alors, bascule du trafic sur la derniere revision ;
#   4. sinon : le trafic RESTE sur l'ancienne revision, et le build echoue.
#
# Usage : deploiement-canari.sh <service> <image> <region> <chemin_sonde> <attendu1> [attendu2...] -- [options gcloud run deploy...]
# Variables : GCLOUD, CURL (substituables pour les tests), CANARI_ESSAIS, CANARI_PAUSE_S.
set -uo pipefail

GCLOUD="${GCLOUD:-gcloud}"
CURL="${CURL:-curl}"
ESSAIS="${CANARI_ESSAIS:-12}"
PAUSE="${CANARI_PAUSE_S:-10}"
ETIQUETTE="candidat"

service="${1:?service}"; image="${2:?image}"; region="${3:?region}"; chemin="${4:?chemin}"; shift 4
attendus=()
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do attendus+=("$1"); shift; done
[ "${1:-}" = "--" ] && shift
if [ "${#attendus[@]}" -eq 0 ]; then echo "canari: aucun critere de sonde, refus" >&2; exit 2; fi

echo "== canari: deploiement sans trafic de $service (etiquette $ETIQUETTE)"
"$GCLOUD" run deploy "$service" --image="$image" --region="$region" --platform=managed \
  --no-traffic --tag="$ETIQUETTE" "$@" || { echo "canari: echec du deploiement" >&2; exit 1; }

url="$("$GCLOUD" run services describe "$service" --region="$region" --format='value(status.url)')"
hote="${url#https://}"
if [ -z "$hote" ] || [ "$hote" = "$url" ]; then echo "canari: URL du service illisible ($url), trafic NON bascule" >&2; exit 1; fi
canari="https://${ETIQUETTE}---${hote}${chemin}"

for i in $(seq 1 "$ESSAIS"); do
  corps="$("$CURL" -s --max-time 20 "$canari" 2>/dev/null || true)"
  manquant=""
  for a in "${attendus[@]}"; do
    case "$corps" in *"$a"*) ;; *) manquant="$a"; break ;; esac
  done
  if [ -z "$manquant" ]; then
    echo "== canari: sonde OK ($canari) — bascule du trafic"
    "$GCLOUD" run services update-traffic "$service" --region="$region" --to-latest \
      || { echo "canari: bascule du trafic en echec" >&2; exit 1; }
    exit 0
  fi
  echo "canari: essai $i/$ESSAIS — attendu absent: $manquant"
  [ "$i" -lt "$ESSAIS" ] && sleep "$PAUSE"
done

echo "canari: la revision candidate n'a pas prouve son bon fonctionnement. Trafic LAISSE sur la revision precedente." >&2
exit 1
