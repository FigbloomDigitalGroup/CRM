#!/bin/sh
# Nightly database backup (FIG-1258 / FIG-1125, docs/BACKUP_RESTORE.md section 2). POSIX sh; runs in the postgres:16-alpine image.
#
# Once a day at BACKUP_HOUR_UTC (default 01) it takes `pg_dump -Fc`, checks that the dump can be read (`pg_restore --list`), records
# its size and SHA-256, keeps 14 daily copies plus 8 weekly (Sundays) and 12 monthly (the 1st), and writes Prometheus metrics that the
# alert rules watch (a missing night is an alert: "no news is not good news"). On failure it retries every 15 minutes until it works.
#
# Environment (all but the password have defaults):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE   connection (the schema owner; never printed)
#   BACKUP_DIR            /backups
#   BACKUP_HOUR_UTC       01
#   BACKUP_ON_START       true: also take one backup at start (default false)
#   RETENTION_DAILY / RETENTION_WEEKLY / RETENTION_MONTHLY   14 / 8 / 12
#   BACKUP_RUN_ONCE       true: take one backup and exit with its result (used for tests)
#
# Limits, by design: the copies are on this host's volume, not off the host, and are not encrypted. Copying them to a second location and
# encrypting them needs storage and keys that only a person can provide (docs/BACKUP_RESTORE.md sections 4, 6 and 9).
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
HOUR="${BACKUP_HOUR_UTC:-01}"
KEEP_D="${RETENTION_DAILY:-14}"
KEEP_W="${RETENTION_WEEKLY:-8}"
KEEP_M="${RETENTION_MONTHLY:-12}"
DB="${PGDATABASE:?PGDATABASE is required}"
export PGCONNECT_TIMEOUT=15
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly" "$BACKUP_DIR/metrics"
log() { echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

count() { ls -1 "$BACKUP_DIR/$1"/*.dump 2>/dev/null | wc -l | tr -d ' '; }

write_metrics() { # status last_success size duration
  tmp="$BACKUP_DIR/metrics/.backup.prom.tmp"
  {
    echo "# HELP figbloom_backup_last_status 1 if the last backup attempt succeeded, 0 if it failed."
    echo "# TYPE figbloom_backup_last_status gauge"
    echo "figbloom_backup_last_status $1"
    echo "# HELP figbloom_backup_last_attempt_timestamp_seconds Unix time of the last backup attempt."
    echo "# TYPE figbloom_backup_last_attempt_timestamp_seconds gauge"
    echo "figbloom_backup_last_attempt_timestamp_seconds $(date -u +%s)"
    if [ -n "$2" ]; then
      echo "# HELP figbloom_backup_last_success_timestamp_seconds Unix time of the last successful backup."
      echo "# TYPE figbloom_backup_last_success_timestamp_seconds gauge"
      echo "figbloom_backup_last_success_timestamp_seconds $2"
    fi
    if [ -n "$3" ]; then
      echo "# HELP figbloom_backup_last_size_bytes Size of the last successful dump."
      echo "# TYPE figbloom_backup_last_size_bytes gauge"
      echo "figbloom_backup_last_size_bytes $3"
      echo "# HELP figbloom_backup_last_duration_seconds Duration of the last successful backup."
      echo "# TYPE figbloom_backup_last_duration_seconds gauge"
      echo "figbloom_backup_last_duration_seconds $4"
    fi
    echo "# HELP figbloom_backup_files Backup files kept, by kind."
    echo "# TYPE figbloom_backup_files gauge"
    for k in daily weekly monthly; do echo "figbloom_backup_files{kind=\"$k\"} $(count $k)"; done
  } > "$tmp" && mv "$tmp" "$BACKUP_DIR/metrics/backup.prom"
}

# Keep the newest $2 dumps in $1 (and their checksum files); delete the rest.
prune() {
  ls -1t "$BACKUP_DIR/$1"/*.dump 2>/dev/null | tail -n +"$(( $2 + 1 ))" | while read -r f; do rm -f "$f" "$f.sha256"; log "pruned $f"; done
}

# Last known success survives a restart (read from the existing metrics file).
last_success() { sed -n 's/^figbloom_backup_last_success_timestamp_seconds \([0-9]*\).*/\1/p' "$BACKUP_DIR/metrics/backup.prom" 2>/dev/null | head -n1; }
last_size() { sed -n 's/^figbloom_backup_last_size_bytes \([0-9]*\).*/\1/p' "$BACKUP_DIR/metrics/backup.prom" 2>/dev/null | head -n1; }
last_dur() { sed -n 's/^figbloom_backup_last_duration_seconds \([0-9]*\).*/\1/p' "$BACKUP_DIR/metrics/backup.prom" 2>/dev/null | head -n1; }

run_backup() {
  start=$(date -u +%s)
  stamp=$(date -u +%Y%m%d-%H%M%S)
  tmpf="$BACKUP_DIR/daily/.figbloom-$stamp.dump.partial"
  final="$BACKUP_DIR/daily/figbloom-$stamp.dump"
  log "starting backup of database $DB"
  if ! pg_dump -Fc -f "$tmpf" "$DB"; then log "FAILED: pg_dump"; rm -f "$tmpf"; write_metrics 0 "$(last_success)" "$(last_size)" "$(last_dur)"; return 1; fi
  if ! pg_restore --list "$tmpf" > /dev/null; then log "FAILED: the dump cannot be read back"; rm -f "$tmpf"; write_metrics 0 "$(last_success)" "$(last_size)" "$(last_dur)"; return 1; fi
  size=$(wc -c < "$tmpf" | tr -d ' ')
  if [ "$size" -lt 1024 ]; then log "FAILED: dump is only $size bytes"; rm -f "$tmpf"; write_metrics 0 "$(last_success)" "$(last_size)" "$(last_dur)"; return 1; fi
  mv "$tmpf" "$final"
  ( cd "$BACKUP_DIR/daily" && sha256sum "$(basename "$final")" > "$final.sha256" )
  # weekly (Sunday) and monthly (the 1st) copies
  [ "$(date -u +%u)" = "7" ] && cp "$final" "$BACKUP_DIR/weekly/" && cp "$final.sha256" "$BACKUP_DIR/weekly/"
  [ "$(date -u +%d)" = "01" ] && cp "$final" "$BACKUP_DIR/monthly/" && cp "$final.sha256" "$BACKUP_DIR/monthly/"
  prune daily "$KEEP_D"; prune weekly "$KEEP_W"; prune monthly "$KEEP_M"
  end=$(date -u +%s)
  write_metrics 1 "$end" "$size" "$(( end - start ))"
  log "OK: $(basename "$final") $size bytes in $(( end - start )) s; kept daily=$(count daily) weekly=$(count weekly) monthly=$(count monthly)"
  return 0
}

# Run until it works, retrying every 15 minutes.
run_until_ok() { until run_backup; do log "retrying in 900 s"; sleep 900; done; }

if [ "${BACKUP_RUN_ONCE:-false}" = "true" ]; then run_backup; exit $?; fi
[ -f "$BACKUP_DIR/metrics/backup.prom" ] || write_metrics 1 "" "" ""   # first start: no success known yet, nothing to alert on until the window passes
if [ "${BACKUP_ON_START:-false}" = "true" ]; then run_until_ok; fi

while true; do
  now=$(date -u +%s)
  wait=$(( (HOUR * 3600 - now % 86400 + 86400) % 86400 ))
  [ "$wait" -lt 60 ] && wait=86400
  log "next backup in $wait s (at ${HOUR}:00 UTC)"
  sleep "$wait"
  run_until_ok
done
