#!/usr/bin/env bash
# gcp-schema-push.sh — Push the Drizzle schema to the Cloud SQL instance
# created by gcp-deploy.sh, via the Cloud SQL Auth Proxy (no public IP /
# authorized-network changes needed on the instance).
#
# Run from the repo root, after gcp-deploy.sh has created the instance:
#
#   bash deploy/gcp-schema-push.sh
set -euo pipefail

PROJECT="$(gcloud config get-value project)"
SQL_INSTANCE="agent-de-bureau-db"
SQL_DB="agent_de_bureau"
SQL_USER="agent"
LOCAL_PORT=15432

SQL_CONNECTION_NAME="$(gcloud sql instances describe "${SQL_INSTANCE}" --project "${PROJECT}" --format='value(connectionName)')"

# Mot de passe: on le derive du secret `database-url`, celui que Cloud Run
# monte reellement, et NON du secret `db-password`. Les deux ont diverge (le
# second n'a pas ete mis a jour lors d'une rotation), si bien que ce script
# echouait sur "password authentication failed for user agent" alors que
# l'application, elle, se connectait sans probleme. Prendre la meme source que
# le service qui tourne evite que les deux redivergent en silence.
DB_URL_SECRET="$(gcloud secrets versions access latest --secret=database-url --project "${PROJECT}")"
DB_PASSWORD="$(printf '%s' "${DB_URL_SECRET}" | sed -e 's|^[^:]*://[^:]*:||' -e 's|@.*$||')"
if [ -z "${DB_PASSWORD}" ]; then
  echo "ERREUR: impossible d'extraire le mot de passe du secret database-url." >&2
  exit 1
fi

# Download the Cloud SQL Auth Proxy if not already present.
PROXY_BIN="./cloud-sql-proxy"
if [ ! -f "${PROXY_BIN}" ] && [ ! -f "${PROXY_BIN}.exe" ]; then
  echo "-- Downloading Cloud SQL Auth Proxy --"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      curl -sSL -o "${PROXY_BIN}.exe" \
        "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.x64.exe"
      PROXY_BIN="${PROXY_BIN}.exe"
      ;;
    *)
      curl -sSL -o "${PROXY_BIN}" \
        "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.14.0/cloud-sql-proxy.linux.amd64"
      chmod +x "${PROXY_BIN}"
      ;;
  esac
fi

echo "-- Starting Cloud SQL Auth Proxy on 127.0.0.1:${LOCAL_PORT} --"
"${PROXY_BIN}" --port "${LOCAL_PORT}" "${SQL_CONNECTION_NAME}" &
PROXY_PID=$!
trap 'kill ${PROXY_PID} 2>/dev/null || true' EXIT

# Give the proxy a moment to establish the tunnel.
for i in $(seq 1 15); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null; then exec 3<&-; exec 3>&-; break; fi
  sleep 1
done

export DATABASE_URL="postgresql://${SQL_USER}:${DB_PASSWORD}@127.0.0.1:${LOCAL_PORT}/${SQL_DB}"

echo "-- Pushing schema --"
cd lib/db
node ./scripts/ensure-search-extensions.mjs
node ./scripts/ensure-unique-constraint-names.mjs
node ./scripts/ensure-automation-logs-rule-id.mjs
node ./scripts/ensure-fk-orphans.mjs
pnpm exec drizzle-kit push --force --config ./drizzle.config.ts
node ./scripts/ensure-audit-append-only.mjs

echo "== Schema push complete =="
