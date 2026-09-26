#!/usr/bin/env sh
# Nightly Postgres backup for the Docker Compose deployment.
#
#   ./deploy/backup.sh                      # run from the project directory
#
# Cron (every night at 02:30; use `crontab -e` as the deploy user):
#   30 2 * * * cd /opt/school-of-purpose && ./deploy/backup.sh >> backups/backup.log 2>&1
#
# Restore a dump (overwrites current data; take a fresh backup first):
#   docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/sop-YYYY-MM-DD_HHMMSS.dump
#
# Backups contain applicants' personal data: keep them private and copy them off
# the server (e.g. to encrypted object storage) regularly.
set -eu

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/sop-$(date +%Y-%m-%d_%H%M%S).dump"

docker compose exec -T db sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner' > "$file.partial"
mv "$file.partial" "$file"

find "$BACKUP_DIR" -name 'sop-*.dump' -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"
