#!/usr/bin/env bash
#
# Run this fork's build next to an upstream build, side by side.
#
#   mine      →  http://localhost:9222   data: $HOME/.imboss-mine
#   upstream  →  http://localhost:9223   data: $HOME/.imboss-upstream
#
# Upstream is built from source in a worktree so both sides go through the same
# pipeline; set IMBOSS_UPSTREAM_APPIMAGE to an official release AppImage to
# compare against the shipped build instead. The current branch is the "mine"
# side, so run this on the private layer (or on any branch you want to look at).
#
# Usage: scripts/private/run-compare.sh [--no-build] [--no-run] [--stop]
#
# Environment knobs:
#   IMBOSS_COMPARE_DIR       worktree + bookkeeping        (default: ~/.cache/imboss-compare)
#   IMBOSS_MINE_HOME         data directory for this fork  (default: ~/.imboss-mine)
#   IMBOSS_UPSTREAM_HOME     data directory for upstream   (default: ~/.imboss-upstream)
#   IMBOSS_MINE_PORT         CDP port for this fork        (default: 9222)
#   IMBOSS_UPSTREAM_PORT     CDP port for upstream         (default: 9223)
#   IMBOSS_UPSTREAM_APPIMAGE official AppImage to use       (default: build from source)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPSTREAM_BRANCH="${IMBOSS_UPSTREAM_BRANCH:-upstream/main}"
COMPARE_DIR="${IMBOSS_COMPARE_DIR:-$HOME/.cache/imboss-compare}"
WORKTREE="$COMPARE_DIR/upstream"
MINE_HOME="${IMBOSS_MINE_HOME:-$HOME/.imboss-mine}"
UPSTREAM_HOME="${IMBOSS_UPSTREAM_HOME:-$HOME/.imboss-upstream}"
MINE_PORT="${IMBOSS_MINE_PORT:-9222}"
UPSTREAM_PORT="${IMBOSS_UPSTREAM_PORT:-9223}"
UPSTREAM_APPIMAGE="${IMBOSS_UPSTREAM_APPIMAGE:-}"

# Run the Electron binary directly (not the npm shim) so the recorded PID is
# the process that actually owns the window.
ELECTRON_BIN="$REPO/node_modules/electron/dist/electron"
[ -x "$ELECTRON_BIN" ] || ELECTRON_BIN="$REPO/node_modules/.bin/electron"

PIDS=()
stop_instances() {
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
  done
  # The npm shim spawns Electron as a grandchild; sweep by port as a fallback.
  pkill -f "remote-debugging-port=$MINE_PORT" 2>/dev/null || true
  pkill -f "remote-debugging-port=$UPSTREAM_PORT" 2>/dev/null || true
}

BUILD=1
RUN=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-run) RUN=0 ;;
    --stop)
      stop_instances
      echo "stopped any instance on ports $MINE_PORT / $UPSTREAM_PORT"
      exit 0
      ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

cd "$REPO"

echo "== fetching upstream"
git fetch upstream --tags --prune

if [ -z "$UPSTREAM_APPIMAGE" ]; then
  if [ -d "$WORKTREE" ]; then
    git -C "$WORKTREE" checkout --detach "$UPSTREAM_BRANCH"
  else
    mkdir -p "$COMPARE_DIR"
    git worktree add --detach "$WORKTREE" "$UPSTREAM_BRANCH"
  fi
  ln -sfn "$REPO/node_modules" "$WORKTREE/node_modules"
fi

if [ "$BUILD" = 1 ]; then
  echo "== building mine — $(git branch --show-current) at $(git rev-parse --short HEAD)"
  node node_modules/@desirecore/electron-vite/bin/electron-vite.js build
  if [ -z "$UPSTREAM_APPIMAGE" ]; then
    echo "== building upstream — $(git -C "$WORKTREE" rev-parse --short HEAD) in $WORKTREE"
    (cd "$WORKTREE" && node node_modules/@desirecore/electron-vite/bin/electron-vite.js build)
  fi
fi

if [ "$RUN" = 0 ]; then
  echo "== built only (--no-run)"
  exit 0
fi

mkdir -p "$MINE_HOME" "$UPSTREAM_HOME"
trap 'echo; echo "stopping both…"; stop_instances; exit 0' INT TERM

if [ -n "$UPSTREAM_APPIMAGE" ]; then
  (cd "$COMPARE_DIR" && export HOME="$UPSTREAM_HOME" && exec "$UPSTREAM_APPIMAGE" --remote-debugging-port="$UPSTREAM_PORT") &
else
  (cd "$WORKTREE" && export HOME="$UPSTREAM_HOME" && exec "$ELECTRON_BIN" . --remote-debugging-port="$UPSTREAM_PORT") &
fi
PIDS+=("$!")

(cd "$REPO" && export HOME="$MINE_HOME" && exec "$ELECTRON_BIN" . --remote-debugging-port="$MINE_PORT") &
PIDS+=("$!")

cat <<EOF

  mine      →  http://localhost:$MINE_PORT    data: $MINE_HOME/.imboss
  upstream  →  http://localhost:$UPSTREAM_PORT    data: $UPSTREAM_HOME/.imboss

  Separate HOMEs keep the two databases apart, so a private branch that added a
  migration cannot corrupt the other side. Each side starts with an empty
  database the first time. Ctrl-C stops both.
EOF

wait
