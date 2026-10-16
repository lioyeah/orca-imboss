#!/usr/bin/env bash
#
# Keep this fork's private layer on top of upstream, then rebuild.
#
#   main  — a pure mirror of upstream/main; never committed to directly
#   mine  — this fork's own changes (the private layer), rebased onto main
#
# Usage: scripts/private/sync-upstream.sh [--no-build] [--no-push]
#
# Environment knobs:
#   IMBOSS_PRIVATE_BRANCH   private layer branch          (default: mine)
#   IMBOSS_UPSTREAM_BRANCH  upstream ref to follow        (default: upstream/main)
#   IMBOSS_MIRROR           remote to mirror main onto    (default: origin)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRIVATE_BRANCH="${IMBOSS_PRIVATE_BRANCH:-mine}"
UPSTREAM_BRANCH="${IMBOSS_UPSTREAM_BRANCH:-upstream/main}"
MIRROR="${IMBOSS_MIRROR:-origin}"

BUILD=1
PUSH=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-push) PUSH=0 ;;
    -h | --help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

cd "$REPO"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Uncommitted changes in the working tree — commit or stash them first." >&2
  exit 1
fi

BEFORE_MAIN="$(git rev-parse main)"

echo "== fetching upstream"
git fetch upstream --tags --prune

echo "== updating main (mirror of $UPSTREAM_BRANCH)"
git switch main
if ! git merge --ff-only "$UPSTREAM_BRANCH"; then
  echo "main is not a fast-forward of $UPSTREAM_BRANCH — main must stay a pure mirror." >&2
  exit 1
fi
if [ "$PUSH" = 1 ]; then
  git push "$MIRROR" main
fi

echo "== rebasing $PRIVATE_BRANCH onto main"
if ! git rev-parse --verify --quiet "$PRIVATE_BRANCH" >/dev/null; then
  echo "   ($PRIVATE_BRANCH does not exist yet — creating it from main)"
  git switch -c "$PRIVATE_BRANCH" main
else
  git switch "$PRIVATE_BRANCH"
fi
if ! git rebase main; then
  cat >&2 <<'EOF'

The rebase stopped on a conflict. Resolve the files, then:
  git add <files> && git rebase --continue
or return to the pre-rebase state with:
  git rebase --abort
EOF
  exit 1
fi

echo
echo "== upstream commits pulled in (${BEFORE_MAIN:0:7}..$(git rev-parse --short main))"
git log --oneline "$BEFORE_MAIN..main"

echo
echo "== private layer (main..$PRIVATE_BRANCH)"
git log --oneline main..HEAD

if [ "$BUILD" = 1 ]; then
  echo
  echo "== building"
  node node_modules/@desirecore/electron-vite/bin/electron-vite.js build
  CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder --linux
  VERSION="$(node -e 'console.log(require("./package.json").version)')"
  echo
  echo "== artifact"
  ls -lh "dist/orca-imboss-$VERSION.AppImage"
  echo "   install it next to the others with:"
  echo "   cp dist/orca-imboss-$VERSION.AppImage ~/Applications/"
fi
