#!/usr/bin/env bash
# Nightly Postgres backup for the production VPS (roadmap Phase 6). Run from cron as root, e.g.
#   15 3 * * *  /opt/insighthub/deploy/backup.sh >> /var/log/insighthub-backup.log 2>&1
# Writes a compressed pg_dump (custom format) readable only by root and keeps the last KEEP_DAYS.
# Restore (TimescaleDB needs its pre/post-restore calls; tested 2026-10-23), into an empty database:
#   psql -d <db> -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()"
#   pg_restore -U postgres -d <db> --no-owner <file>
#   psql -d <db> -c "SELECT timescaledb_post_restore()"
# pg_dump's "circular foreign-key constraints" warning about continuous_agg is expected with Timescale.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/insighthub}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/insighthub-$stamp.dump"

# Dump inside the container (no password on the command line); write to a temp file first so a
# failed dump never replaces a good one.
docker compose --project-directory "$COMPOSE_DIR" exec -T postgres \
  pg_dump -U postgres -d insighthub --format=custom --compress=9 > "$target.partial"
mv "$target.partial" "$target"

# Sanity check: the archive must list its contents.
docker compose --project-directory "$COMPOSE_DIR" exec -T postgres pg_restore --list < "$target" > /dev/null

find "$BACKUP_DIR" -name 'insighthub-*.dump' -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $target ($(du -h "$target" | cut -f1))"
