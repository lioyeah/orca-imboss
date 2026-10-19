#!/usr/bin/env bash
#
# Launch the live desktop client directly from source build against real ~/.imboss data.
# Eliminates the need to repackage an AppImage: builds in ~1.7s and starts immediately.
#
# Usage:
#   scripts/private/run-live.sh             # Build + stop old + launch in background
#   scripts/private/run-live.sh --fg        # Build + stop old + launch in foreground
#   scripts/private/run-live.sh --no-build  # Launch without rebuilding
#   scripts/private/run-live.sh --stop      # Stop running live instance
#   scripts/private/run-live.sh --status    # Check status of live instance
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE="/tmp/orca-imboss-live.pid"
LOGFILE="/tmp/orca-imboss-live.log"
ELECTRON_BIN="$REPO/node_modules/electron/dist/electron"
[ -x "$ELECTRON_BIN" ] || ELECTRON_BIN="$REPO/node_modules/.bin/electron"

stop_instance() {
  echo "== Stopping running imboss/electron instances..."
  # Kill recorded PID if any
  if [ -f "$PIDFILE" ]; then
    local rpid
    rpid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$rpid" ] && kill -0 "$rpid" 2>/dev/null; then
      kill "$rpid" 2>/dev/null || true
      sleep 0.5
      kill -9 "$rpid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi

  # Kill any remaining orca-imboss or live electron processes pointing to this repo
  pkill -f "orca-imboss" 2>/dev/null || true
  pkill -f "$ELECTRON_BIN.*$REPO" 2>/dev/null || true

  # Clean up stale Electron singleton locks
  rm -f "$HOME/.config/orca-imboss/Singleton"* 2>/dev/null || true
  sleep 0.5
  echo "== Stopped."
}

status_instance() {
  if pgrep -f "orca-imboss|electron.*$REPO" >/dev/null 2>&1; then
    echo "== imboss live instance is RUNNING:"
    ps aux | grep -E "orca-imboss|electron.*$REPO" | grep -v grep | head -n 5
  else
    echo "== imboss live instance is NOT running."
  fi
}

BUILD=1
FOREGROUND=0

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --fg) FOREGROUND=1 ;;
    --stop) stop_instance; exit 0 ;;
    --status) status_instance; exit 0 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$REPO"

# Always ensure old instance is stopped before starting a new one
stop_instance

if [ "$BUILD" = 1 ]; then
  echo "== Building app (pnpm run build)..."
  pnpm run build
fi

echo "== Launching live imboss client against real ~/.imboss..."

# Important: unset ELECTRON_RUN_AS_NODE so Electron runs as GUI app, not plain node.
ENV_CMD=(env -u ELECTRON_RUN_AS_NODE DISPLAY="${DISPLAY:-:0}" WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}")

if [ "$FOREGROUND" = 1 ]; then
  exec "${ENV_CMD[@]}" "$ELECTRON_BIN" "$REPO" --no-sandbox --ozone-platform=wayland
else
  nohup "${ENV_CMD[@]}" "$ELECTRON_BIN" "$REPO" --no-sandbox --ozone-platform=wayland > "$LOGFILE" 2>&1 &
  NEW_PID=$!
  echo "$NEW_PID" > "$PIDFILE"
  sleep 1
  if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "== Launched successfully in background (PID: $NEW_PID)."
    echo "   Logs: tail -f $LOGFILE"
  else
    echo "== Failed to launch. Check $LOGFILE for details:"
    tail -n 20 "$LOGFILE"
    exit 1
  fi
fi
