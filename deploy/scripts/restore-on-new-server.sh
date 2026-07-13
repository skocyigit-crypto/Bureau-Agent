#!/usr/bin/env bash
# Restore a SQL dump produced by export-from-replit.sh into the running
# Docker Compose Postgres container.
#
# Usage:  ./deploy/scripts/restore-on-new-server.sh agent-de-bureau-YYYYMMDD-HHMMSS.sql.gz
set -euo pipefail

DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 <dump.sql.gz>" >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-deploy/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/.env.example to deploy/.env first." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file $ENV_FILE"

echo "Ensuring database container is up..."
$COMPOSE up -d db
sleep 3

echo "Restoring $DUMP into ${POSTGRES_DB:-agent_de_bureau} ..."
gunzip -c "$DUMP" | $COMPOSE exec -T db psql \
  -U "${POSTGRES_USER:-agent}" \
  -d "${POSTGRES_DB:-agent_de_bureau}"

echo "Restore complete."
