#!/bin/sh
# deploy.sh — Copy today's downloaded files to two target project folders.
#
# Usage:
#   ./deploy.sh              — copy today's files
#   ./deploy.sh --dry-run    — show what would be copied
#   ./deploy.sh --all        — copy all files (ignore date filter)

# ============================================================
# CONFIGURATION — edit these paths
# ============================================================
DOWNLOADS_DIR="$HOME/Downloads"
TARGET_1="/opt/jira-manager-1"
TARGET_2="/opt/jira-manager-2"

# ============================================================
DRY_RUN=false
ALL_FILES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --all)     ALL_FILES=true ;;
  esac
done

if $DRY_RUN; then
  echo "=== DRY RUN ==="
  echo ""
fi

# Filename -> relative path in project
get_rel_path() {
  case "$1" in
    server.js)            echo "server.js" ;;
    db.js)                echo "db.js" ;;
    mock-data.js)         echo "mock-data.js" ;;
    package.json)         echo "package.json" ;;
    config.example.json)  echo "config.example.json" ;;
    start.sh)             echo "start.sh" ;;
    start.bat)            echo "start.bat" ;;
    start-mock.sh)        echo "start-mock.sh" ;;
    deploy.sh)            echo "deploy.sh" ;;
    index.html)           echo "public/index.html" ;;
    styles.css)           echo "public/css/styles.css" ;;
    app.js)               echo "public/js/app.js" ;;
    api.js)               echo "public/js/api.js" ;;
    ui.js)                echo "public/js/ui.js" ;;
    *)                    echo "" ;;
  esac
}

if [ ! -d "$DOWNLOADS_DIR" ]; then
  echo "ERROR: Downloads directory not found: $DOWNLOADS_DIR"
  exit 1
fi

TODAY=$(date +%Y-%m-%d)
echo "Source:   $DOWNLOADS_DIR"
echo "Target 1: $TARGET_1"
echo "Target 2: $TARGET_2"
if ! $ALL_FILES; then
  echo "Filter:   today ($TODAY)"
fi
echo ""

copied=0
skipped=0
found=0

for src_file in "$DOWNLOADS_DIR"/*; do
  [ -f "$src_file" ] || continue

  fname=$(basename "$src_file")
  rel_path=$(get_rel_path "$fname")

  # Skip files not in our project
  [ -z "$rel_path" ] && continue

  # Date filter: only today's files (by modification date)
  if ! $ALL_FILES; then
    file_date=$(date -r "$src_file" +%Y-%m-%d 2>/dev/null || stat -c %y "$src_file" 2>/dev/null | cut -d' ' -f1)
    if [ "$file_date" != "$TODAY" ]; then
      continue
    fi
  fi

  found=$((found + 1))
  echo "  $fname -> $rel_path"

  for target in "$TARGET_1" "$TARGET_2"; do
    dest="$target/$rel_path"
    dest_dir=$(dirname "$dest")

    if [ ! -d "$target" ]; then
      echo "    SKIP $target (not found)"
      skipped=$((skipped + 1))
      continue
    fi

    if $DRY_RUN; then
      echo "    -> $dest"
    else
      mkdir -p "$dest_dir"
      if cp "$src_file" "$dest"; then
        echo "    OK $dest"
        copied=$((copied + 1))
      else
        echo "    FAIL $dest"
      fi
    fi
  done
done

echo ""
if [ "$found" = "0" ]; then
  echo "No matching project files found in $DOWNLOADS_DIR"
  if ! $ALL_FILES; then
    echo "Try: ./deploy.sh --all  (to ignore date filter)"
  fi
else
  echo "Found: $found files  Copied: $copied  Skipped: $skipped"
fi
