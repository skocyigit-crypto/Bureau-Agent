#!/usr/bin/env bash
# Export the Replit Postgres database to a portable SQL dump that can be
# restored on the new Docker Compose stack.
#
# Run this INSIDE the Replit shell (where DATABASE_URL is set), then download
# the resulting file and restore it on the new server with restore-on-new-server.sh
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set. Run this inside the Replit shell." >&2
  exit 1
fi

OUT="agent-de-bureau-$(date +%Y%m%d-%H%M%S).sql.gz"

echo "Dumping database to $OUT ..."
pg_dump \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --quote-all-identifiers \
  --format=plain \
  "$DATABASE_URL" | gzip -9 > "$OUT"

echo "Done."
echo "Size: $(du -h "$OUT" | cut -f1)"
echo
echo "Next steps:"
echo "  1. Download $OUT from this Replit project."
echo "  2. Copy it to your new server."
echo "  3. Run:  ./deploy/scripts/restore-on-new-server.sh $OUT"
