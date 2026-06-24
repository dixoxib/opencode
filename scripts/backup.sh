#!/usr/bin/env bash
set -euo pipefail

SRC="${1:-.}"
DST="/mnt/share"
NAME="opencode-backup-$(date +%Y%m%d-%H%M%S).tar.zst"
MANIFEST="$DST/.backup-manifest"

mkdir -p "$DST"

# Collect files: git-tracked + modified + new agent-addons
FILES=$(mktemp)
trap "rm -f $FILES" EXIT

if git -C "$SRC" rev-parse --is-inside-work-tree &>/dev/null; then
  # Git mode: tracked files that differ from HEAD + new untracked in agent-addons
  git -C "$SRC" diff --name-only HEAD > "$FILES"
  git -C "$SRC" diff --name-only --cached >> "$FILES" 2>/dev/null || true
  git -C "$SRC" ls-files --others --exclude-standard \
    | grep -E 'agent-addons/|_project_|_deepseek|_flags|me_deepseek' >> "$FILES" || true
  
  # Always include key project files
  for f in _project_plan.md _project_history.md _project_memory.md me_deepseek.txt; do
    [ -f "$SRC/$f" ] && echo "$f" >> "$FILES"
  done
else
  # Fallback: find files modified in last 7 days
  find "$SRC" -type f -mtime -7 \
    ! -path '*/node_modules/*' \
    ! -path '*/.git/*' \
    ! -path '*/bun.lock' \
    ! -name '*.json' \
    >> "$FILES"
fi

# Deduplicate and filter to existing files only
sort -u "$FILES" | while read -r f; do
  [ -f "$SRC/$f" ] && echo "$f"
done > "${FILES}.filtered"

COUNT=$(wc -l < "${FILES}.filtered")
if [ "$COUNT" -eq 0 ]; then
  echo "No changes to backup."
  exit 0
fi

echo "Backing up $COUNT files..."

tar -cf - -C "$SRC" -T "${FILES}.filtered" \
  | zstd -T0 -3 > "$DST/$NAME"

SIZE=$(du -h "$DST/$NAME" | cut -f1)
echo "→ $DST/$NAME ($SIZE, $COUNT files)"

# Update manifest
echo "$(date -Iseconds)  $NAME  $COUNT files  $SIZE" >> "$MANIFEST"
