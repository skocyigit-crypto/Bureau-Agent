#!/usr/bin/env bash
# check-anthropic-key.sh — Le conseil AI (Gemini / OpenAI / Anthropic) ne peut
# se plaindre que d'une chose du cote Anthropic: la cle est valide, mais
# l'organisation peut avoir franchi son plafond de depense mensuel. Ce script
# fait UN vrai appel `POST /v1/messages` — le seul qui distingue « la cle est
# bonne » de « le compte est ouvert » — et dit lequel des deux est vrai.
#
# Depuis la racine du depot (fonctionne aussi depuis PowerShell):
#
#   bash scripts/check-anthropic-key.sh
#
set -euo pipefail

PROJECT="${GCP_PROJECT:-gwmme-1771577941260}"
SECRET="${ANTHROPIC_SECRET_NAME:-batiflow-anthropic-api-key}"
MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-6}"

# La cle vient de Secret Manager, la meme source que Cloud Run monte: tester
# une copie collee a la main reviendrait a tester autre chose que la prod.
if ! KEY="$(gcloud secrets versions access latest --secret="${SECRET}" --project "${PROJECT}" 2>/dev/null)"; then
  echo "ERREUR: lecture impossible du secret ${SECRET} (projet ${PROJECT})." >&2
  echo "Verifiez 'gcloud auth login' et les droits secretmanager.secretAccessor." >&2
  exit 1
fi

BODY_FILE="$(mktemp)"
# La cle passe par un fichier d'en-tetes, jamais par la ligne de commande: elle
# n'apparait donc ni dans l'historique du shell ni dans la liste des processus.
HEADERS_FILE="$(mktemp)"
trap 'rm -f "${BODY_FILE}" "${HEADERS_FILE}"' EXIT
{
  printf 'x-api-key: %s\n' "${KEY}"
  printf 'anthropic-version: 2023-06-01\n'
  printf 'content-type: application/json\n'
} > "${HEADERS_FILE}"

CODE="$(curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
  https://api.anthropic.com/v1/messages \
  -H "@${HEADERS_FILE}" \
  -d "{\"model\":\"${MODEL}\",\"max_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}")"

echo "HTTP ${CODE} (modele ${MODEL})"

case "${CODE}" in
  200)
    echo "OK — Anthropic repond. Le conseil AI tourne bien avec ses trois fournisseurs."
    exit 0
    ;;
  429)
    if grep -q 'enforced_spend_limit_reached' "${BODY_FILE}"; then
      echo "BLOQUE — plafond de depense mensuel atteint sur le compte Anthropic."
      echo "Anthropic Console -> Plans & Billing pour relever le palier."
    else
      echo "BLOQUE — quota/debit depasse (voir la reponse ci-dessous)."
    fi
    ;;
  401|403)
    echo "BLOQUE — cle refusee. Elle est partagee avec batiflow: une rotation la-bas"
    echo "arrete aussi agent-de-bureau (voir AI_AUTOMATION_ROADMAP.md, point 3)."
    ;;
  404)
    echo "BLOQUE — modele introuvable pour ce compte: ${MODEL}."
    ;;
esac

head -c 800 "${BODY_FILE}"
echo
exit 1
