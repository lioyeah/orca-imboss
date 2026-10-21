#!/usr/bin/env bash
#
# Launch the live desktop client directly from source build against real ~/.imboss data.
# Eliminates the need to repackage an AppImage: builds in ~1.7s and starts immediately.
# Includes automatic atomic database snapshots before each launch to prevent any data loss.
#
# Usage:
#   scripts/private/run-live.sh                 # Backup DB + build + stop old + launch via systemd-run --user
#   scripts/private/run-live.sh --no-build      # Backup DB + launch without rebuilding
#   scripts/private/run-live.sh --no-backup     # Launch without taking a DB snapshot
#   scripts/private/run-live.sh --backup        # Create an atomic DB snapshot immediately (no launch)
#   scripts/private/run-live.sh --backups       # List all available DB snapshots
#   scripts/private/run-live.sh --restore [FILE]# Restore DB from latest or specified snapshot
#   scripts/private/run-live.sh --stop          # Stop running live instance
#   scripts/private/run-live.sh --status        # Check status of live instance
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_NAME="app-orca-imboss-live.service"
ELECTRON_BIN="$REPO/node_modules/electron/dist/electron"
[ -x "$ELECTRON_BIN" ] || ELECTRON_BIN="$REPO/node_modules/.bin/electron"

DATA_ROOT="$HOME/.imboss"
DB_DIR="$DATA_ROOT/db"
DB_FILE="$DB_DIR/imboss.db"
BACKUP_DIR="$DB_DIR/backups"
INTEGRATIONS_FILE="$DATA_ROOT/integrations.json"
MAX_BACKUPS=20

stop_instance() {
  echo "== Stopping running imboss/electron instances..."
  systemctl --user stop "$UNIT_NAME" 2>/dev/null || true

  # Safely sweep only Electron processes executing from this repo (never agy/shell)
  for pid in $(pgrep -f "$ELECTRON_BIN" 2>/dev/null || true); do
    if [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ]; then
      local exe
      exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      if [[ "$exe" == "$REPO"/*/electron* ]] || [[ "$exe" == "$ELECTRON_BIN"* ]]; then
        kill "$pid" 2>/dev/null || true
      fi
    fi
  done

  # Clean up stale Electron singleton locks
  rm -f "$HOME/.config/orca-imboss/Singleton"* 2>/dev/null || true
  sleep 0.5
  echo "== Stopped."
}

status_instance() {
  if systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "== imboss live service ($UNIT_NAME) is ACTIVE:"
    systemctl --user status "$UNIT_NAME" --no-pager
  else
    local running=0
    for pid in $(pgrep -f "$ELECTRON_BIN" 2>/dev/null || true); do
      local exe
      exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      if [[ "$exe" == "$REPO"/*/electron* ]] || [[ "$exe" == "$ELECTRON_BIN"* ]]; then
        echo "== imboss live instance (PID $pid) is RUNNING outside systemd:"
        ps -o pid,user,args -p "$pid"
        running=1
      fi
    done
    if [ "$running" = 0 ]; then
      echo "== imboss live instance is NOT running."
    fi
  fi
}

backup_database() {
  if [ ! -f "$DB_FILE" ]; then
    echo "== Database file not found at $DB_FILE (new installation?), skipping backup."
    return 0
  fi

  mkdir -p "$BACKUP_DIR"
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local target_db="$BACKUP_DIR/imboss_${timestamp}.db"

  echo "== Verifying database integrity before snapshot..."
  local check
  check="$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1 || true)"
  if [ "$check" != "ok" ]; then
    echo "!! WARNING: SQLite integrity check reported: $check" >&2
    echo "   Continuing to snapshot existing state for forensics..."
  fi

  local user_ver
  user_ver="$(sqlite3 "$DB_FILE" "PRAGMA user_version;" 2>/dev/null || echo "unknown")"

  echo "== Creating atomic snapshot: $target_db (user_version=$user_ver)..."
  sqlite3 "$DB_FILE" ".backup '$target_db'"

  if [ -f "$INTEGRATIONS_FILE" ]; then
    cp -a "$INTEGRATIONS_FILE" "$BACKUP_DIR/integrations_${timestamp}.json" 2>/dev/null || true
  fi

  # Rotation: prune oldest backups exceeding MAX_BACKUPS
  local count
  count="$(find "$BACKUP_DIR" -maxdepth 1 -name "imboss_*.db" | wc -l)"
  if [ "$count" -gt "$MAX_BACKUPS" ]; then
    local excess=$(( count - MAX_BACKUPS ))
    find "$BACKUP_DIR" -maxdepth 1 -name "imboss_*.db" | sort | head -n "$excess" | while read -r old_file; do
      rm -f "$old_file"
      local old_json="${old_file%.db}.json"
      old_json="${old_json/imboss_/integrations_}"
      rm -f "$old_json"
    done
  fi

  echo "== Database snapshot saved successfully."
}

list_backups() {
  echo "== Available database backups in $BACKUP_DIR:"
  if [ ! -d "$BACKUP_DIR" ] || [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -name "imboss_*.db" 2>/dev/null)" ]; then
    echo "   (No backups found)"
    return 0
  fi
  printf "%-32s %-10s %-12s %s\n" "SNAPSHOT" "SIZE" "VERSION" "INTEGRITY"
  printf "%-32s %-10s %-12s %s\n" "--------" "----" "-------" "---------"
  find "$BACKUP_DIR" -maxdepth 1 -name "imboss_*.db" | sort -r | while read -r f; do
    local base size ver check
    base="$(basename "$f")"
    size="$(du -h "$f" | cut -f1)"
    ver="$(sqlite3 "$f" "PRAGMA user_version;" 2>/dev/null || echo "err")"
    check="$(sqlite3 "$f" "PRAGMA integrity_check;" 2>/dev/null || echo "fail")"
    printf "%-32s %-10s %-12s %s\n" "$base" "$size" "v$ver" "$check"
  done
}

restore_database() {
  local target="${1:-latest}"
  local restore_file=""

  if [ ! -d "$BACKUP_DIR" ]; then
    echo "Error: Backup directory $BACKUP_DIR does not exist." >&2
    exit 1
  fi

  if [ "$target" = "latest" ]; then
    restore_file="$(find "$BACKUP_DIR" -maxdepth 1 -name "imboss_*.db" | sort -r | head -n 1)"
    if [ -z "$restore_file" ]; then
      echo "Error: No backups available to restore." >&2
      exit 1
    fi
  elif [ -f "$target" ]; then
    restore_file="$target"
  elif [ -f "$BACKUP_DIR/$target" ]; then
    restore_file="$BACKUP_DIR/$target"
  else
    echo "Error: Specified backup '$target' not found." >&2
    exit 1
  fi

  echo "== Stopping instances before database restore..."
  stop_instance

  echo "== Taking safety snapshot of current DB before replacement..."
  if [ -f "$DB_FILE" ]; then
    local pre_restore="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).db"
    sqlite3 "$DB_FILE" ".backup '$pre_restore'" || cp -a "$DB_FILE" "$pre_restore"
    echo "   Current DB preserved as $pre_restore"
  fi

  echo "== Restoring database from $restore_file -> $DB_FILE..."
  # Clean up any residual WAL or SHM files
  rm -f "${DB_FILE}-wal" "${DB_FILE}-shm"
  cp -a "$restore_file" "$DB_FILE"

  local corresponding_json="${restore_file%.db}.json"
  corresponding_json="${corresponding_json/imboss_/integrations_}"
  if [ -f "$corresponding_json" ]; then
    echo "== Restoring integrations config: $corresponding_json -> $INTEGRATIONS_FILE..."
    cp -a "$corresponding_json" "$INTEGRATIONS_FILE"
  fi

  echo "== Database restore completed successfully."
  sqlite3 "$DB_FILE" "PRAGMA integrity_check;"
}

BUILD=1
BACKUP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build)  BUILD=0; shift ;;
    --no-backup) BACKUP=0; shift ;;
    --backup)
      backup_database
      exit 0
      ;;
    --backups)
      list_backups
      exit 0
      ;;
    --restore)
      shift
      restore_database "${1:-latest}"
      exit 0
      ;;
    --stop)   stop_instance; exit 0 ;;
    --status) status_instance; exit 0 ;;
    -h|--help)
      sed -n '2,17p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

cd "$REPO"

# Always ensure old instance is stopped before starting a new one
stop_instance

# 1. Automatic database backup before touching any app files or schemas
if [ "$BACKUP" = 1 ]; then
  backup_database
fi

# 2. Build app from current source
if [ "$BUILD" = 1 ]; then
  echo "== Building app (pnpm run build)..."
  pnpm run build
fi

# 3. Launch live instance via systemd user unit
echo "== Launching live imboss client against real ~/.imboss via systemd-run --user..."

systemd-run --user --unit=app-orca-imboss-live \
  env -u ELECTRON_RUN_AS_NODE DISPLAY="${DISPLAY:-:0}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}" \
  "$ELECTRON_BIN" "$REPO" --no-sandbox --ozone-platform=wayland

sleep 1
if systemctl --user is-active --quiet "$UNIT_NAME"; then
  echo "== Launched successfully as systemd user unit: $UNIT_NAME"
  echo "   View logs: journalctl --user -u $UNIT_NAME -f"
  echo "   Stop:      ./scripts/private/run-live.sh --stop"
else
  echo "== Service did not become active. Status:"
  systemctl --user status "$UNIT_NAME" --no-pager || true
  exit 1
fi
