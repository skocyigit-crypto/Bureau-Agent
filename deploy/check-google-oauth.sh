#!/usr/bin/env bash
# check-google-oauth.sh — Dit si la connexion Google est REELLEMENT branchee
# en production, au lieu de le supposer.
#
# Pourquoi ce script existe. Le 4 septembre 2026, la feuille de route affirmait
# encore que le client OAuth restait a creer, et cette affirmation a ete
# repetee toute une journee. Mesure faite: les trois variables etaient deja
# configurees sur Cloud Run, et les API Gmail/Calendar/Drive activees. Personne
# n'avait menti — la note n'avait simplement jamais ete reverifiee.
#
# Une affirmation de blocage est elle aussi une mesure: elle se verifie, ou
# elle se tait. Ce script rend la verification plus courte que la supposition.
#
# Depuis la racine du depot (fonctionne aussi depuis PowerShell):
#
#   bash deploy/check-google-oauth.sh
#
set -euo pipefail

PROJECT="${GCP_PROJECT:-gwmme-1771577941260}"
REGION="${REGION:-europe-west9}"
API_SERVICE="${API_SERVICE:-agent-de-bureau-api}"
EXPECTED_REDIRECT="${EXPECTED_REDIRECT:-https://app.agentdebureau.fr/api/google-oauth/callback}"

echo "== ${API_SERVICE} (${PROJECT} / ${REGION}) =="

ENV_JSON="$(gcloud run services describe "${API_SERVICE}" \
  --region "${REGION}" --project "${PROJECT}" --format=json)"

# La valeur du secret n'est jamais lue: seule sa PRESENCE compte ici.
STATUS=0
report() {
  local name="$1" found="$2" detail="$3"
  if [ "${found}" = "1" ]; then
    printf '  OK      %-22s %s\n' "${name}" "${detail}"
  else
    printf '  MANQUE  %-22s %s\n' "${name}" "${detail}"
    STATUS=1
  fi
}

eval "$(printf '%s' "${ENV_JSON}" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const env = JSON.parse(s).spec.template.spec.containers[0].env || [];
  const find = (n) => env.find((e) => e.name === n);
  const id = find("GOOGLE_CLIENT_ID");
  const secret = find("GOOGLE_CLIENT_SECRET");
  const redirect = find("GOOGLE_REDIRECT_URI");
  const out = {
    ID_FOUND: id && (id.value || id.valueFrom) ? 1 : 0,
    // On expose la LONGUEUR et la fin, jamais la valeur: de quoi reconnaitre
    // un vrai identifiant sans le recopier dans un journal de CI.
    ID_TAIL: id && id.value ? id.value.slice(-24) : (id && id.valueFrom ? "(via un secret)" : ""),
    SECRET_FOUND: secret && (secret.value || secret.valueFrom) ? 1 : 0,
    SECRET_SRC: secret && secret.valueFrom ? secret.valueFrom.secretKeyRef.name : (secret ? "(en clair)" : ""),
    REDIRECT_FOUND: redirect && redirect.value ? 1 : 0,
    REDIRECT: redirect && redirect.value ? redirect.value : "",
  };
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${JSON.stringify(String(v))}`);
});
')"

report "GOOGLE_CLIENT_ID" "${ID_FOUND}" "...${ID_TAIL}"
report "GOOGLE_CLIENT_SECRET" "${SECRET_FOUND}" "${SECRET_SRC}"
report "GOOGLE_REDIRECT_URI" "${REDIRECT_FOUND}" "${REDIRECT}"

if [ "${REDIRECT_FOUND}" = "1" ] && [ "${REDIRECT}" != "${EXPECTED_REDIRECT}" ]; then
  echo "  ATTENTION  l'URI de redirection differe de celle attendue:"
  echo "             attendu ${EXPECTED_REDIRECT}"
  echo "             Google refuse le consentement si elle ne figure pas, au"
  echo "             caractere pres, dans les URI autorisees du client OAuth."
  STATUS=1
fi

echo "-- API Google activees --"
ENABLED="$(gcloud services list --enabled --project "${PROJECT}" --format='value(config.name)')"
for api in gmail.googleapis.com calendar-json.googleapis.com drive.googleapis.com; do
  if printf '%s\n' "${ENABLED}" | grep -qx "${api}"; then
    printf '  OK      %s\n' "${api}"
  else
    printf '  MANQUE  %s\n' "${api}"
    STATUS=1
  fi
done

cat <<'EOF'

-- Ce que ce script NE peut pas dire --
L'ecran de consentement OAuth est-il publie en "External"? Cela ne s'expose ni
par gcloud ni par l'API: c'est un reglage de la console. S'il ne l'est pas, la
configuration ci-dessus est correcte mais seuls les comptes de test peuvent se
connecter.

La seule preuve de bout en bout est de connecter un compte Google depuis
l'application (Parametres -> Google). Tant que ce n'est pas fait, ne pas
ecrire qu'Autonomous Inbox fonctionne.
EOF

exit "${STATUS}"
