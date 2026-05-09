#!/usr/bin/env bash
##############################################################################
# Agent de Bureau — Self-Hosted Server Setup Script
#
# Tested on Ubuntu 22.04 / Debian 12.
# Run as root (or with sudo) on a fresh VPS.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/.../setup.sh | bash
#   -or-
#   chmod +x setup.sh && sudo ./setup.sh
##############################################################################

set -euo pipefail

BLUE='\033[0;34m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${CYAN}[ADB]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK ]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR ]${NC} $*"; exit 1; }

APP_USER="adb"
APP_DIR="/var/www/agentdebureau"
LOG_DIR="/var/log/agentdebureau"
NODE_VERSION="22"
PNPM_VERSION="9"
PG_VERSION="16"

# ---------------------------------------------------------------------------
log "Updating system packages..."
# ---------------------------------------------------------------------------
apt-get update -q && apt-get upgrade -y -q

# ---------------------------------------------------------------------------
log "Installing core dependencies..."
# ---------------------------------------------------------------------------
apt-get install -y -q \
  curl git unzip build-essential \
  nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib \
  ufw fail2ban

# ---------------------------------------------------------------------------
log "Installing Node.js ${NODE_VERSION}..."
# ---------------------------------------------------------------------------
if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt "$NODE_VERSION" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y -q nodejs
fi
ok "Node.js $(node --version)"

# ---------------------------------------------------------------------------
log "Installing pnpm..."
# ---------------------------------------------------------------------------
npm install -g pnpm@${PNPM_VERSION} pm2
ok "pnpm $(pnpm --version)"
ok "pm2 $(pm2 --version)"

# ---------------------------------------------------------------------------
log "Creating app user '${APP_USER}'..."
# ---------------------------------------------------------------------------
if ! id "$APP_USER" &>/dev/null; then
  useradd -r -m -d "$APP_DIR" -s /bin/bash "$APP_USER"
fi

# ---------------------------------------------------------------------------
log "Creating directories..."
# ---------------------------------------------------------------------------
mkdir -p "$APP_DIR" "$LOG_DIR"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$LOG_DIR"

# ---------------------------------------------------------------------------
log "Configuring PostgreSQL ${PG_VERSION}..."
# ---------------------------------------------------------------------------
systemctl enable postgresql && systemctl start postgresql

PG_DB="agentdebureau"
PG_USER="adb_user"
PG_PASS="$(openssl rand -hex 24)"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PG_USER}') THEN
      CREATE ROLE ${PG_USER} LOGIN PASSWORD '${PG_PASS}';
    END IF;
  END \$\$;
  SELECT 'CREATE DATABASE ${PG_DB}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PG_DB}') \\gexec
  GRANT ALL PRIVILEGES ON DATABASE ${PG_DB} TO ${PG_USER};
SQL

# Install extensions and the f_unaccent() IMMUTABLE wrapper used by the
# accent-insensitive trigram search indexes declared in the Drizzle schema.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${PG_DB}" <<'SQL'
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS unaccent;
  CREATE OR REPLACE FUNCTION f_unaccent(text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
  AS $$ SELECT public.unaccent('public.unaccent', $1) $$;
SQL

DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}"
ok "PostgreSQL configured. Database URL saved below — add to .env"

# ---------------------------------------------------------------------------
log "Configuring UFW firewall..."
# ---------------------------------------------------------------------------
ufw --force enable
ufw allow OpenSSH
ufw allow 'Nginx Full'
ok "Firewall configured (SSH + HTTP/HTTPS)"

# ---------------------------------------------------------------------------
log "Configuring Nginx..."
# ---------------------------------------------------------------------------
cp "$(dirname "$0")/nginx.conf" /etc/nginx/sites-available/agentdebureau
if [ ! -f /etc/nginx/sites-enabled/agentdebureau ]; then
  ln -s /etc/nginx/sites-available/agentdebureau /etc/nginx/sites-enabled/
fi
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ok "Nginx configured"

# ---------------------------------------------------------------------------
log "Setting up PM2 auto-start..."
# ---------------------------------------------------------------------------
pm2 startup systemd -u "$APP_USER" --hp "$APP_DIR" | tail -1 | bash || true
ok "PM2 startup configured"

# ---------------------------------------------------------------------------
log "Installing pm2-logrotate..."
# ---------------------------------------------------------------------------
pm2 install pm2-logrotate || true
pm2 set pm2-logrotate:max_size 100M || true
pm2 set pm2-logrotate:retain 7 || true

# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN} Agent de Bureau — Server Setup Complete!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Copy your built app to ${APP_DIR}"
echo "  2. Create ${APP_DIR}/.env from deploy/.env.template"
echo "     DATABASE_URL=${DATABASE_URL}"
echo "  3. Run migrations:"
echo "     cd ${APP_DIR} && pnpm --filter @workspace/db run migrate"
echo "  4. Start the API with PM2:"
echo "     pm2 start deploy/ecosystem.config.js"
echo "  5. Set up SSL with Certbot:"
echo "     certbot --nginx -d YOUR_DOMAIN"
echo ""
warn "Save your DB password: ${PG_PASS}"
echo ""
