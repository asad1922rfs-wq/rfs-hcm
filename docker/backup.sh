#!/bin/sh
# Nightly PostgreSQL backup at 02:00 PKT (21:00 UTC), keeping BACKUP_RETENTION_DAYS days.
# Copy the backups off the VPS as well (e.g. Hostinger snapshots or rclone to cloud storage) —
# a backup that lives only on the same server does not survive losing that server.
# Restore: gunzip -c rfs_hcm_YYYYMMDD_HHMM.sql.gz | psql -h db -U $PGUSER -d $PGDATABASE
set -eu

run_backup() {
  file="/backups/rfs_hcm_$(date -u +%Y%m%d_%H%M).sql.gz"
  pg_dump --no-owner --clean --if-exists | gzip > "$file.tmp"
  mv "$file.tmp" "$file"
  find /backups -name 'rfs_hcm_*.sql.gz' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete
  echo "$(date -u) backup written: $file"
}

while true; do
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%Y-%m-%d) 21:00:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$target" -le "$now" ] && target=$((target + 86400))
  sleep $((target - now))
  run_backup || echo "$(date -u) BACKUP FAILED" >&2
done
