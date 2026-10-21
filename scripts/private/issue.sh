#!/usr/bin/env bash
#
# Issue helper for the private fork's Issue-Driven PDCA Workflow.
#
# Usage:
#   scripts/private/issue.sh list              # List all tracked issues and statuses
#   scripts/private/issue.sh new <slug> [title]# Create next NNN-<slug>.md from template
#   scripts/private/issue.sh status            # Alias for list
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ISSUES_DIR="$REPO/scripts/private/issues"
TEMPLATE="$ISSUES_DIR/000-template.md"

list_issues() {
  echo "== Tracked Issues in scripts/private/issues/:"
  printf "%-6s %-32s %-16s %s\n" "ID" "SLUG" "STATUS" "TITLE"
  printf "%-6s %-32s %-16s %s\n" "----" "--------------------------------" "----------------" "--------------------------------"

  find "$ISSUES_DIR" -maxdepth 1 -name "[0-9][0-9][0-9]-*.md" | sort | while read -r f; do
    local base num slug status title
    base="$(basename "$f" .md)"
    # Exclude template and blueprint documents from issue status list
    if [[ "$base" == "000-template" ]] || [[ "$base" == *"-blueprint" ]]; then
      continue
    fi
    num="${base:0:3}"
    slug="${base:4}"
    status="$(grep -m 1 -E '^- (\*\*状态\*\*:|状态：)' "$f" 2>/dev/null | sed -E 's/^- (\*\*状态\*\*:|状态：)[ `]*//; s/[`].*$//; s/（.*$//' || echo "unknown")"
    title="$(grep -m 1 '^# ' "$f" 2>/dev/null | sed -E 's/^# [0-9]+[ ·—]*//' || echo "$slug")"
    printf "%-6s %-32s %-16s %s\n" "$num" "$slug" "$status" "$title"
  done
}

new_issue() {
  local slug="${1:-}"
  local title="${2:-}"

  if [ -z "$slug" ]; then
    echo "Usage: $0 new <slug> [title]" >&2
    echo "  Example: $0 new composer-border-radius '输入框圆角视觉不协调'" >&2
    exit 1
  fi

  # Sanitize slug
  slug="$(echo "$slug" | tr '[:upper:]' '[:lower:]' | tr ' _' '--' | tr -cd 'a-z0-9-')"

  # Find next sequence number
  local max_num=0
  for f in "$ISSUES_DIR"/[0-9][0-9][0-9]-*.md; do
    [ -f "$f" ] || continue
    local b num
    b="$(basename "$f")"
    num="${b:0:3}"
    # Strip leading zeros for arithmetic
    num=$((10#$num))
    if [ "$num" -gt "$max_num" ]; then
      max_num="$num"
    fi
  done

  local next_num=$(( max_num + 1 ))
  local next_id
  printf -v next_id "%03d" "$next_num"

  local target_file="$ISSUES_DIR/${next_id}-${slug}.md"
  local evidence_dir="$ISSUES_DIR/evidence/${next_id}-${slug}"

  if [ -f "$target_file" ]; then
    echo "Error: $target_file already exists!" >&2
    exit 1
  fi

  mkdir -p "$evidence_dir"

  # Extract template markdown starting from line 46 (# NNN ...)
  sed -n '/^```markdown/,/^```$/ { /^```/d; p; }' "$TEMPLATE" | \
    sed "s/NNN/${next_id}/g; s/<一句话标题：看到什么 + 在哪里>/${title:-$slug}/g; s/<YYYY-MM-DD>/$(date +%Y-%m-%d)/g" \
    >"$target_file"

  echo "== Created new issue tracking document:"
  echo "   File:     scripts/private/issues/${next_id}-${slug}.md"
  echo "   Evidence: scripts/private/issues/evidence/${next_id}-${slug}/"
  echo
  echo "Next steps:"
  echo "   1. Edit ${target_file} to record baseline and acceptance criteria."
  echo "   2. Follow AGENTS.md §5 Issue-Driven PDCA Workflow to implement and verify."
}

case "${1:-list}" in
  list|status)
    list_issues
    ;;
  new)
    shift
    new_issue "$@"
    ;;
  -h|--help)
    sed -n '2,10p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Use $0 list or $0 new <slug> [title]" >&2
    exit 1
    ;;
esac
