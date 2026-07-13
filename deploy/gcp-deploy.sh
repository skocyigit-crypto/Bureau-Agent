#!/usr/bin/env bash
# gcp-deploy.sh — Deploy Agent de Bureau (api + web) to Cloud Run, with a
# dedicated Cloud SQL Postgres instance, on the currently active gcloud
# project/account. Run from the repo root:
#
#   bash deploy/gcp-deploy.sh
#
# Idempotent-ish: safe to re-run after a partial failure (each step checks
# whether its resource already exists before creating it). Does NOT touch
# any existing resources outside the names defined below (in particular,
# never touches "vertubat-*" or any other pre-existing service in this
# project).
#
# Requires: gcloud authenticated (gcloud auth login) with billing enabled
# on the active project, and a GEMINI_API_KEY exported in this shell before
# running (falls back to the value already in deploy/.env if present).
set -euo pipefail

# ---------------------------------------------------------------------------
# Config — edit here if you want different names/region/tier.
# ---------------------------------------------------------------------------
PROJECT="$(gcloud config get-value project)"
REGION="europe-west9"                    # Paris — matches the existing vertubat-* services
SQL_INSTANCE="agent-de-bureau-db"
SQL_TIER="db-f1-micro"                   # cheapest shared-core Postgres tier (~10-15$/mo)
SQL_DB="agent_de_bureau"
SQL_USER="agent"
AR_REPO="agent-de-bureau"                # Artifact Registry Docker repo
API_SERVICE="agent-de-bureau-api"
WEB_SERVICE="agent-de-bureau-web"
IMAGE_API="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/api:latest"
IMAGE_WEB="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/web:latest"

echo "== Project: ${PROJECT} | Region: ${REGION} =="

# ---------------------------------------------------------------------------
# 0. Load GEMINI_API_KEY / ADMIN_EMAIL / ADMIN_PASSWORD from deploy/.env if
#    not already exported.
# ---------------------------------------------------------------------------
load_from_env_file() {
  local var="$1"
  if [ -z "${!var:-}" ] && [ -f deploy/.env ]; then
    grep -m1 "^${var}=" deploy/.env | cut -d= -f2-
  fi
}
[ -z "${GEMINI_API_KEY:-}" ] && GEMINI_API_KEY="$(load_from_env_file GEMINI_API_KEY)"
[ -z "${ADMIN_EMAIL:-}" ] && ADMIN_EMAIL="$(load_from_env_file ADMIN_EMAIL)"
[ -z "${ADMIN_PASSWORD:-}" ] && ADMIN_PASSWORD="$(load_from_env_file ADMIN_PASSWORD)"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@agentdebureau.fr}"
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "GEMINI_API_KEY not set (env var or deploy/.env) — AI features will be unavailable until configured later." >&2
fi

# ---------------------------------------------------------------------------
# 1. Enable required APIs (no-op if already enabled).
# ---------------------------------------------------------------------------
echo "-- Enabling APIs --"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  --project "${PROJECT}"

# ---------------------------------------------------------------------------
# 2. Artifact Registry repo for Docker images.
# ---------------------------------------------------------------------------
echo "-- Artifact Registry repo --"
if ! gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" --project "${PROJECT}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format=docker --location="${REGION}" \
    --description="Agent de Bureau container images" --project "${PROJECT}"
else
  echo "   already exists, skipping"
fi
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ---------------------------------------------------------------------------
# 3. Cloud SQL — new, dedicated instance (does not touch vertubat-db).
# ---------------------------------------------------------------------------
echo "-- Cloud SQL instance --"
if ! gcloud sql instances describe "${SQL_INSTANCE}" --project "${PROJECT}" >/dev/null 2>&1; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  gcloud sql instances create "${SQL_INSTANCE}" \
    --database-version=POSTGRES_16 \
    --tier="${SQL_TIER}" \
    --region="${REGION}" \
    --storage-size=10GB --storage-auto-increase \
    --project "${PROJECT}"
  gcloud sql users set-password postgres --instance="${SQL_INSTANCE}" --password="${DB_PASSWORD}" --project "${PROJECT}"
  gcloud sql users create "${SQL_USER}" --instance="${SQL_INSTANCE}" --password="${DB_PASSWORD}" --project "${PROJECT}"
  gcloud sql databases create "${SQL_DB}" --instance="${SQL_INSTANCE}" --project "${PROJECT}"
  echo "${DB_PASSWORD}" | gcloud secrets create db-password --data-file=- --project "${PROJECT}" 2>/dev/null \
    || echo -n "${DB_PASSWORD}" | gcloud secrets versions add db-password --data-file=- --project "${PROJECT}"
else
  echo "   already exists, skipping creation (reusing stored db-password secret)"
fi
SQL_CONNECTION_NAME="$(gcloud sql instances describe "${SQL_INSTANCE}" --project "${PROJECT}" --format='value(connectionName)')"
echo "   connectionName: ${SQL_CONNECTION_NAME}"

# ---------------------------------------------------------------------------
# 4. Secrets in Secret Manager (generated once, reused on re-run).
# ---------------------------------------------------------------------------
echo "-- Secrets --"
create_or_reuse_secret() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" --project "${PROJECT}" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --project "${PROJECT}"
  else
    echo "   $name already exists, leaving as-is"
  fi
}
create_or_reuse_secret session-secret "$(openssl rand -hex 32)"
create_or_reuse_secret data-encryption-key "$(openssl rand -hex 32)"
create_or_reuse_secret admin-password "${ADMIN_PASSWORD:-$(openssl rand -base64 18)Aa1!}"
if [ -n "${GEMINI_API_KEY:-}" ]; then
  create_or_reuse_secret gemini-api-key "${GEMINI_API_KEY}"
fi

# ---------------------------------------------------------------------------
# 5. Build + push the api image via Cloud Build (context = repo root).
# ---------------------------------------------------------------------------
echo "-- Building api image via Cloud Build --"
gcloud builds submit . --config /dev/stdin --project "${PROJECT}" <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'deploy/Dockerfile.api', '-t', '${IMAGE_API}', '.']
images: ['${IMAGE_API}']
timeout: 1200s
options:
  machineType: 'E2_HIGHCPU_8'
EOF

# ---------------------------------------------------------------------------
# 6. Deploy the api Cloud Run service.
# ---------------------------------------------------------------------------
echo "-- Deploying ${API_SERVICE} --"
DATABASE_URL="postgresql://${SQL_USER}@/${SQL_DB}?host=/cloudsql/${SQL_CONNECTION_NAME}"
SECRET_REFS="SESSION_SECRET=session-secret:latest,DATA_ENCRYPTION_KEY=data-encryption-key:latest,ADMIN_PASSWORD=admin-password:latest,DB_PASSWORD=db-password:latest"
if gcloud secrets describe gemini-api-key --project "${PROJECT}" >/dev/null 2>&1; then
  SECRET_REFS="${SECRET_REFS},GEMINI_API_KEY=gemini-api-key:latest"
fi

gcloud run deploy "${API_SERVICE}" \
  --image="${IMAGE_API}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances="${SQL_CONNECTION_NAME}" \
  --set-env-vars="NODE_ENV=production,ADMIN_EMAIL=${ADMIN_EMAIL},DATABASE_URL_TEMPLATE=${DATABASE_URL}" \
  --set-secrets="${SECRET_REFS}" \
  --min-instances=0 --max-instances=3 --memory=512Mi --cpu=1 \
  --port=8080

API_URL="$(gcloud run services describe "${API_SERVICE}" --region="${REGION}" --project "${PROJECT}" --format='value(status.url)')"
echo "   api deployed at: ${API_URL}"

# NOTE: DATABASE_URL still needs the DB_PASSWORD interpolated in — Cloud Run
# --set-env-vars can't reference another secret inline, so this is patched
# as a second update once the password secret's value is resolvable here:
DB_PASSWORD_VALUE="$(gcloud secrets versions access latest --secret=db-password --project "${PROJECT}")"
gcloud run services update "${API_SERVICE}" \
  --region="${REGION}" --project="${PROJECT}" \
  --update-env-vars="DATABASE_URL=postgresql://${SQL_USER}:${DB_PASSWORD_VALUE}@/${SQL_DB}?host=/cloudsql/${SQL_CONNECTION_NAME}"

# ---------------------------------------------------------------------------
# 7. Push the Drizzle schema to the new database (via Cloud SQL Auth Proxy).
# ---------------------------------------------------------------------------
echo "-- Pushing DB schema --"
echo "   (requires the Cloud SQL Auth Proxy; run scripts/gcp-schema-push.sh separately"
echo "    if this step is skipped here, or once the proxy binary is available.)"

# ---------------------------------------------------------------------------
# 8. Build + deploy the web (buro-ajani) Cloud Run service, pointed at the
#    api service's real URL.
# ---------------------------------------------------------------------------
echo "-- Building web image via Cloud Build --"
API_HOST="$(echo "${API_URL}" | sed -e 's|https://||' -e 's|http://||')"
gcloud builds submit . --config /dev/stdin --project "${PROJECT}" <<EOF
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-f', 'deploy/Dockerfile.web.cloudrun', '-t', '${IMAGE_WEB}', '.']
images: ['${IMAGE_WEB}']
timeout: 900s
EOF

echo "-- Deploying ${WEB_SERVICE} --"
gcloud run deploy "${WEB_SERVICE}" \
  --image="${IMAGE_WEB}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars="API_UPSTREAM=${API_HOST}:443" \
  --min-instances=0 --max-instances=3 --memory=256Mi --cpu=1 \
  --port=8080

WEB_URL="$(gcloud run services describe "${WEB_SERVICE}" --region="${REGION}" --project "${PROJECT}" --format='value(status.url)')"

echo ""
echo "== Done =="
echo "api: ${API_URL}"
echo "web: ${WEB_URL}"
