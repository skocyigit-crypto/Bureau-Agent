#!/usr/bin/env bash
# setup-google-oauth.sh — Branche l'application OAuth Google de la plateforme
# sur Cloud Run: secrets, droits d'acces, variable de redirection, verification.
#
# La seule partie qui ne peut PAS etre scriptee est la creation du client OAuth
# dans la Google Cloud Console (elle demande un proprietaire humain du projet).
# Ce script prend la suite, a partir des deux valeurs qu'elle produit:
#
#   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... bash deploy/setup-google-oauth.sh
#
# ou, si les valeurs sont deja dans deploy/.env, simplement:
#
#   bash deploy/setup-google-oauth.sh
#
# Sans cela, Autonomous Inbox et le volet e-mail du Super Agent repondent
# "aucun Gmail connecte" pour CHAQUE organisation: ce n'est pas une panne
# visible, c'est une fonctionnalite silencieusement absente.
set -euo pipefail

PROJECT="$(gcloud config get-value project)"
REGION="${REGION:-europe-west9}"
API_SERVICE="${API_SERVICE:-agent-de-bureau-api}"
WEB_SERVICE="${WEB_SERVICE:-agent-de-bureau-web}"
PUBLIC_HOST="${PUBLIC_HOST:-https://app.agentdebureau.fr}"

load_from_env_file() {
  local var="$1"
  if [ -z "${!var:-}" ] && [ -f deploy/.env ]; then
    grep -m1 "^${var}=" deploy/.env | cut -d= -f2-
  fi
}
[ -z "${GOOGLE_CLIENT_ID:-}" ] && GOOGLE_CLIENT_ID="$(load_from_env_file GOOGLE_CLIENT_ID)"
[ -z "${GOOGLE_CLIENT_SECRET:-}" ] && GOOGLE_CLIENT_SECRET="$(load_from_env_file GOOGLE_CLIENT_SECRET)"

# L'URI de redirection DOIT pointer sur le service web, jamais sur l'API.
# Apres le callback, le code redirige en RELATIF vers /parametres
# (routes/google-oauth.ts, baseUrl = "/"): l'API ne sert pas cette page, donc
# une URI pointant sur l'API laisse l'utilisateur sur un 404 juste apres avoir
# accorde le consentement. Le service web, lui, proxifie deja /api* vers l'API
# (deploy/Caddyfile.cloudrun), il execute donc le callback ET ramene dans
# l'application.
REDIRECT_URI="${GOOGLE_REDIRECT_URI:-${PUBLIC_HOST%/}/api/google-oauth/callback}"

if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
  cat >&2 <<EOF
ERREUR: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET absents.

A faire une seule fois, dans la Google Cloud Console (projet ${PROJECT}):
  1. APIs & Services -> Library: activer "Gmail API", "Google Calendar API",
     "Google Drive API".
  2. APIs & Services -> OAuth consent screen: type "External", publier
     l'application (sinon seuls les comptes de test peuvent se connecter).
  3. APIs & Services -> Credentials -> Create credentials -> OAuth client ID
     -> type "Web application".
  4. Authorized redirect URIs -> ajouter EXACTEMENT:

       ${REDIRECT_URI}

  5. Copier l'ID et le secret, puis relancer:

       GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... bash deploy/setup-google-oauth.sh
EOF
  exit 1
fi

echo "== Projet: ${PROJECT} | Region: ${REGION} =="
echo "   redirect_uri: ${REDIRECT_URI}"

# ---------------------------------------------------------------------------
# 1. Secrets. On ajoute toujours une version: relancer le script apres une
#    rotation cote Google doit reellement remplacer la valeur, pas la garder.
# ---------------------------------------------------------------------------
put_secret() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" --project "${PROJECT}" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --project "${PROJECT}" >/dev/null
    echo "   secret cree: $name"
  else
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project "${PROJECT}" >/dev/null
    echo "   nouvelle version: $name"
  fi
}
echo "-- Secrets --"
put_secret google-client-id "${GOOGLE_CLIENT_ID}"
put_secret google-client-secret "${GOOGLE_CLIENT_SECRET}"

# ---------------------------------------------------------------------------
# 2. Droit de lecture pour le compte de service qui execute l'API. Sans lui, le
#    deploiement echoue au demarrage du conteneur, pas au moment du deploiement:
#    l'erreur arrive donc apres coup, sur une revision qui ne demarre jamais.
# ---------------------------------------------------------------------------
RUNTIME_SA="$(gcloud run services describe "${API_SERVICE}" --region "${REGION}" --project "${PROJECT}" \
  --format='value(spec.template.spec.serviceAccountName)')"
if [ -z "${RUNTIME_SA}" ]; then
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
  RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi
echo "-- Acces secrets pour ${RUNTIME_SA} --"
for s in google-client-id google-client-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project "${PROJECT}" >/dev/null
done
echo "   ok"

# ---------------------------------------------------------------------------
# 3. Montage sur le service API. --update-* ne touche que les cles nommees: les
#    autres variables et secrets deja en place sont conserves.
# ---------------------------------------------------------------------------
echo "-- Mise a jour de ${API_SERVICE} --"
gcloud run services update "${API_SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --update-secrets="GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest" \
  --update-env-vars="GOOGLE_REDIRECT_URI=${REDIRECT_URI}" >/dev/null
echo "   ok"

# ---------------------------------------------------------------------------
# 4. Verification par relecture. On ne conclut pas depuis le fait que les
#    commandes precedentes n'ont pas echoue: on relit la revision servante.
# ---------------------------------------------------------------------------
echo "-- Verification --"
DESC="$(gcloud run services describe "${API_SERVICE}" --region "${REGION}" --project "${PROJECT}" \
  --format='yaml(spec.template.spec.containers[0].env)')"
FAIL=0
for key in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI; do
  if printf '%s' "${DESC}" | grep -q "${key}"; then
    echo "   ${key}: monte"
  else
    echo "   ${key}: MANQUANT" >&2
    FAIL=1
  fi
done
if printf '%s' "${DESC}" | grep -q "GOOGLE_REDIRECT_URI" && ! printf '%s' "${DESC}" | grep -q "${REDIRECT_URI}"; then
  echo "   ATTENTION: GOOGLE_REDIRECT_URI en place mais differente de ${REDIRECT_URI}" >&2
fi
[ "${FAIL}" = "0" ] || exit 1

cat <<EOF

== Google OAuth branche ==

Il reste UNE chose que seul un humain peut confirmer, et c'est celle qui casse
le plus souvent (redirect_uri_mismatch): l'URI ci-dessous doit figurer, au
caractere pres, dans les "Authorized redirect URIs" du client OAuth:

    ${REDIRECT_URI}

Test de bout en bout: se connecter a ${PUBLIC_HOST}, aller dans Parametres ->
connecter un compte Google, accorder le consentement. Le retour doit atterrir
sur /parametres avec le compte liste — pas sur un 404, pas sur une erreur
Google. Ensuite seulement, Autonomous Inbox a de quoi lire une boite.
EOF
