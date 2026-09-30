#!/usr/bin/env sh
# Nightly Postgres backup: the Docker Compose deployment, or (--local) Postgres on this server.
#
#   ./deploy/backup.sh                      # Docker Compose: run from the project directory
#   sudo BACKUP_DIR=/var/backups/sop ./deploy/backup.sh --local   # bare metal, as root
#
# Cron (every night at 02:30; `sudo crontab -e`). The script names files itself, so the cron
# line needs no `%` (cron would cut the command there):
#   30 2 * * * cd /opt/school-of-purpose && ./deploy/backup.sh >> backups/backup.log 2>&1
#   30 2 * * * cd /opt/school-of-purpose && BACKUP_DIR=/var/backups/sop ./deploy/backup.sh --local >> /var/log/sop-backup.log 2>&1
#
# Files are readable by their owner only (umask 077). --local dumps the database in PGDATABASE
# (default sop) as the postgres user, which needs root.
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
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/sop-$(date +%Y-%m-%d_%H%M%S).dump"
# A failed dump leaves nothing behind (a partial one still holds personal data).
trap 'rm -f "$file.partial"' EXIT

if [ "${1:-}" = "--local" ]; then
  runuser -u postgres -- pg_dump --dbname="${PGDATABASE:-sop}" --format=custom --no-owner > "$file.partial"
else
  docker compose exec -T db sh -c \
    'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner' > "$file.partial"
fi
mv "$file.partial" "$file"

find "$BACKUP_DIR" -name 'sop-*.dump' -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup written: $file ($(du -h "$file" | cut -f1))"
