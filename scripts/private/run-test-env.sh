#!/usr/bin/env bash
#
# Launch an isolated UI test instance of this fork's build.
#
# Every UI verification / fix round runs here, never on the boss's running
# instance. Isolation is by HOME only, because getDataRoot()
# (src/main/data-dir.ts) hardcodes the storage root to ~/.imboss and has no
# environment override — the same trick scripts/private/run-compare.sh uses.
#
#   test env →  http://localhost:9224   data: ~/.imboss-ui-test/.imboss
#
# Usage: scripts/private/run-test-env.sh [--no-build] [--stop] [--status]
#
# There is deliberately no --headless mode: #3 and #4 drive the real window with
# cua-driver and need actual screenshots, and a headless instance would make
# every GUI verification worthless.
#
# Isolation contract:
#   * HOME for the launched app is ALWAYS $IMBOSS_TEST_HOME (default
#     ~/.imboss-ui-test), never the real HOME. The script refuses to start if
#     the two ever collide, and refuses to stop a process that is not ours.
#   * CDP port defaults to 9224 (compare uses 9222/9223) so a running
#     comparison is never disturbed.
#   * The single-instance lock (app.requestSingleInstanceLock(),
#     src/main/index.ts) is keyed on the Electron userData directory, which
#     follows HOME — a separate HOME means a separate lock, so the test
#     instance and the boss's instance (~/.imboss) can run side by side.
#   * --stop only ever kills the PID this script recorded, or, as a fallback,
#     a process whose command line mentions our CDP port. No broad-spectrum
#     pkill imboss/orca/electron — that would take the boss's instance down.
#
# Why the build step runs under the real HOME:
#   pnpm is a mise shim and mise keeps its toolchain under the real HOME
#   (~/.local/share/mise), so `pnpm run build` cannot run under a foreign HOME.
#   This is safe: the build only compiles src/ into out/ and never executes the
#   app's main process, and getDataRoot() is only called at runtime. Isolation
#   is enforced at launch time, where it matters. Set IMBOSS_TEST_BUILD_CMD to
#   override the build command (e.g. to build with a different toolchain).
#
# Environment knobs:
#   IMBOSS_TEST_HOME        data HOME for the test instance (default: ~/.imboss-ui-test)
#   IMBOSS_TEST_PORT        CDP port                       (default: 9224)
#   IMBOSS_TEST_LOG         log file                       (default: $IMBOSS_TEST_HOME/imboss-test.log)
#   IMBOSS_TEST_BUILD_CMD   build command                  (default: "pnpm run build")
#   IMBOSS_TEST_EXTRA_ARGS  extra electron args            (default: "--no-sandbox")
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_HOME="${IMBOSS_TEST_HOME:-$HOME/.imboss-ui-test}"
TEST_PORT="${IMBOSS_TEST_PORT:-9224}"
TEST_LOG="${IMBOSS_TEST_LOG:-$TEST_HOME/imboss-test.log}"
BUILD_CMD="${IMBOSS_TEST_BUILD_CMD:-pnpm run build}"
# Matches the flags the boss's AppImage instance runs with (--ozone-platform=wayland),
# so the test window is a native Wayland client the Wayland-backed cua-driver can see.
EXTRA_ARGS="${IMBOSS_TEST_EXTRA_ARGS:---no-sandbox --ozone-platform=wayland}"
PIDFILE="$TEST_HOME/imboss-test.pid"
BASELINE="$TEST_HOME/boss-baseline.txt"

ELECTRON_BIN="$REPO/node_modules/electron/dist/electron"
[ -x "$ELECTRON_BIN" ] || ELECTRON_BIN="$REPO/node_modules/.bin/electron"

die() { echo "run-test-env: $*" >&2; exit 1; }

# Never let the test instance run against the boss's data root.
[ "$TEST_HOME" != "$HOME" ] || die "IMBOSS_TEST_HOME must not be the real HOME"
case "$TEST_HOME" in
  "$HOME"/.imboss|"$HOME"/.imboss/*) die "IMBOSS_TEST_HOME must not live inside $HOME/.imboss" ;;
esac

# PIDs that must never be killed: this script and every ancestor up to init.
# A port-scoped sweep matches any command line that merely MENTIONS the port —
# including the operator's own shell — so the sweep is narrowed to real Electron
# invocations and this tree is excluded explicitly.
protected_pids() {
  local pid="$$" chain=""
  while [ -n "$pid" ] && [ "$pid" != "1" ]; do
    chain="$chain $pid"
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  done
  echo "$chain 1"
}
PROTECTED=" $(protected_pids) "

# A leftover Electron process of ours: argv[0] must BE the Electron binary and
# the command line must carry our CDP port and this repo. A shell that merely
# mentions the port (or even "electron" + port + repo) can never match, because
# its argv[0] is a shell. The boss's instance fails twice over: different
# argv[0], and its command line names the AppImage and the boss's data root.
# A leftover Electron process of ours: /proc/PID/exe must be THIS repo's Electron
# binary and the command line must carry our CDP port. (argv[0] cannot be used
# here: on this host /proc/PID/cmdline is space-joined rather than NUL-separated,
# so the first field is not recoverable when the repo path contains a space.)
# The boss's instance fails twice over: its exe is /tmp/.mount_*/orca-imboss or
# the AppImage, and its command line names the AppImage and the boss's data root.
is_our_electron() {
  local pid="$1" cmdline exe
  case "$PROTECTED" in *" $pid "*) return 1 ;; esac
  exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
  case "$exe" in
    "$REPO"/*/electron) ;;
    *) return 1 ;;
  esac
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [ -n "$cmdline" ] || return 1
  case "$cmdline" in
    *AppImage*|*"$HOME/.imboss"*) return 1 ;;
    *"remote-debugging-port=$TEST_PORT"*) return 0 ;;
    *) return 1 ;;
  esac
}

recorded_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  is_our_electron "$pid" || return 1
  echo "$pid"
}

stop_instance() {
  local pid stopped=0 leftover
  if [ -f "$PIDFILE" ]; then
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -z "$pid" ]; then
      echo "run-test-env: $PIDFILE is empty; removing it"
      rm -f "$PIDFILE"
    elif ! kill -0 "$pid" 2>/dev/null; then
      echo "== recorded PID $pid is gone; cleaning $PIDFILE"
      rm -f "$PIDFILE"
    elif is_our_electron "$pid"; then
      echo "== stopping test instance PID $pid"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
      kill -9 "$pid" 2>/dev/null || true
      rm -f "$PIDFILE"
      stopped=1
    else
      # Refuse to kill an unrecognised process, and keep the pidfile as evidence.
      echo "run-test-env: REFUSING to kill PID $pid — it is not recognised as our"
      echo "  test Electron instance. Inspect it yourself: ps -o args= -p $pid"
      echo "  Keeping $PIDFILE."
      return 1
    fi
  fi
  # Fallback sweep: ONLY real Electron processes whose argv[0] is the Electron
  # binary and whose command line carries our port and this repo. Never a
  # name-based pkill, never our own process tree, never the boss's AppImage.
  for leftover in $(pgrep -f "remote-debugging-port=$TEST_PORT" 2>/dev/null || true); do
    if is_our_electron "$leftover"; then
      echo "== sweeping leftover electron PID $leftover"
      kill "$leftover" 2>/dev/null || true
      stopped=1
    fi
  done
  [ "$stopped" = 1 ] || echo "no test instance running (nothing recorded in $PIDFILE)"
  return 0
}

# Evidence that the boss's instance and data root are untouched.
snapshot_boss() {
  echo "boss instance processes (PID + elapsed + cmdline, truncated):"
  ps -eo pid,etime,args | grep -iE "appimage|imboss|electron" | grep -v grep \
    | grep -v "run-test-env" | grep -v "$REPO" | cut -c1-160 | sed 's/^/  /' || true
  [ -n "$(ps -eo pid,args | grep -iE 'appimage|imboss|electron' | grep -v grep | grep -v run-test-env | grep -v "$REPO" || true)" ] || echo "  (none)"
  echo "data root $HOME/.imboss:"
  stat -c '  mtime %y  %n' "$HOME/.imboss" 2>/dev/null || echo "  (absent)"
}

BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --stop) stop_instance; exit 0 ;;
    --status)
      if pid="$(recorded_pid)"; then
        echo "test instance: RUNNING  PID $pid  HOME $TEST_HOME  port $TEST_PORT"
        curl -s "http://127.0.0.1:$TEST_PORT/json/version" || echo "  (CDP not answering)"
        echo
      else
        echo "test instance: not running"
      fi
      snapshot_boss
      if [ -f "$BASELINE" ]; then echo; echo "baseline taken at start:"; cat "$BASELINE"; fi
      exit 0
      ;;
    -h | --help) sed -n '2,40p' "$0"; exit 0 ;;
    *) die "unknown option: $arg" ;;
  esac
done

if pid="$(recorded_pid)"; then
  die "test instance already running (PID $pid). Stop it first: $0 --stop"
fi

mkdir -p "$TEST_HOME"

# Baseline for the "boss untouched" check: PID list + data-root mtime.
{
  echo "taken: $(date -Is)"
  snapshot_boss
} >"$BASELINE"

if [ "$BUILD" = 1 ]; then
  echo "== building $(git -C "$REPO" branch --show-current) at $(git -C "$REPO" rev-parse --short HEAD)"
  echo "== build command: $BUILD_CMD  (real HOME: the toolchain needs it; the build never touches app data)"
  (cd "$REPO" && eval "$BUILD_CMD")
fi

[ -f "$REPO/out/main/index.js" ] || die "no build found at $REPO/out/main/index.js — run without --no-build first"

echo "== launching test instance"
echo "   HOME   $TEST_HOME   (data root $TEST_HOME/.imboss)"
echo "   CDP    http://127.0.0.1:$TEST_PORT"
echo "   log    $TEST_LOG"

# nohup keeps the instance alive after this script exits, so a later turn (or a
# CDP driver) can attach to it. HOME is exported per-process, never globally.
nohup env HOME="$TEST_HOME" "$ELECTRON_BIN" "$REPO" $EXTRA_ARGS \
  --remote-debugging-port="$TEST_PORT" >"$TEST_LOG" 2>&1 &
TEST_PID=$!
echo "$TEST_PID" >"$PIDFILE"

# Wait for the CDP endpoint, then prove the data root really is the isolated one.
cdp_ok=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$TEST_PORT/json/version" >/dev/null 2>&1; then cdp_ok=1; break; fi
  kill -0 "$TEST_PID" 2>/dev/null || break
  sleep 0.5
done

echo
if [ "$cdp_ok" = 1 ]; then
  echo "test instance is up:"
  curl -s "http://127.0.0.1:$TEST_PORT/json/version"; echo
  echo "targets:"
  curl -s "http://127.0.0.1:$TEST_PORT/json/list" | grep -o '"title": "[^"]*"' | head -5 || true
else
  echo "CDP endpoint did not come up — last log lines:" >&2
  tail -20 "$TEST_LOG" >&2 || true
  exit 1
fi

sleep 2
echo
echo "== isolation check"
if [ -d "$TEST_HOME/.imboss" ]; then
  echo "OK  data root $TEST_HOME/.imboss exists (isolated from $HOME/.imboss)"
  ls "$TEST_HOME/.imboss" | sed 's/^/    /'
else
  echo "WARN $TEST_HOME/.imboss not created yet — the app may still be starting; check again with --status"
fi
echo "test instance PID $TEST_PID recorded in $PIDFILE"
echo
echo "== boss instance after launch (must be unchanged)"
snapshot_boss
echo
echo "Stop with: $0 --stop    Status with: $0 --status"
