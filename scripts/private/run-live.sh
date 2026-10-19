#!/usr/bin/env bash
#
# Launch the live desktop client directly from source build against real ~/.imboss data.
# Eliminates the need to repackage an AppImage: builds in ~1.7s and starts immediately.
#
# Usage:
#   scripts/private/run-live.sh             # Build + stop old + launch via systemd-run --user
#   scripts/private/run-live.sh --no-build  # Launch without rebuilding
#   scripts/private/run-live.sh --stop      # Stop running live instance
#   scripts/private/run-live.sh --status    # Check status of live instance
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_NAME="app-orca-imboss-live.service"
ELECTRON_BIN="$REPO/node_modules/electron/dist/electron"
[ -x "$ELECTRON_BIN" ] || ELECTRON_BIN="$REPO/node_modules/.bin/electron"

stop_instance() {
  echo "== Stopping running imboss/electron instances..."
  systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
  pkill -f "orca-imboss" 2>/dev/null || true
  pkill -f "$ELECTRON_BIN.*$REPO" 2>/dev/null || true

  # Clean up stale Electron singleton locks
  rm -f "$HOME/.config/orca-imboss/Singleton"* 2>/dev/null || true
  sleep 0.5
  echo "== Stopped."
}

status_instance() {
  if systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "== imboss live service ($UNIT_NAME) is ACTIVE:"
    systemctl --user status "$UNIT_NAME" --no-pager
  elif pgrep -f "orca-imboss|electron.*$REPO" >/dev/null 2>&1; then
    echo "== imboss live instance is RUNNING outside systemd:"
    ps aux | grep -E "orca-imboss|electron.*$REPO" | grep -v grep | head -n 5
  else
    echo "== imboss live instance is NOT running."
  fi
}

BUILD=1

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --stop) stop_instance; exit 0 ;;
    --status) status_instance; exit 0 ;;
    -h|--help)
      sed -n '2,12p' "$0"
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
