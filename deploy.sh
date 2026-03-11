#!/bin/sh
# deploy.sh — Copy changed files from Downloads to two target project folders.
#
# Usage:
#   1. Commit changes, download the changed files to DOWNLOADS_DIR (flat or with structure)
#   2. Run: ./deploy.sh
#   or to do a dry-run first: ./deploy.sh --dry-run

# ============================================================
# CONFIGURATION — edit these paths
# ============================================================
DOWNLOADS_DIR="$HOME/Downloads/jira-manager"
TARGET_1="/opt/jira-manager-1"
TARGET_2="/opt/jira-manager-2"

# ============================================================
DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo "=== DRY RUN — no files will be copied ==="
  echo ""
fi

copied=0
skipped=0
errors=0

# Filename → relative path mapping (portable, no associative arrays)
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

# Check downloads dir
if [ ! -d "$DOWNLOADS_DIR" ]; then
  echo "ERROR: Downloads directory not found: $DOWNLOADS_DIR"
  exit 1
fi

echo "Source:   $DOWNLOADS_DIR"
echo "Target 1: $TARGET_1"
echo "Target 2: $TARGET_2"
echo ""

# Find all files in downloads dir
find "$DOWNLOADS_DIR" -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.json" -o -name "*.sh" -o -name "*.bat" \) ! -name ".*" | while read -r src_file; do
  fname=$(basename "$src_file")
  rel_path=$(get_rel_path "$fname")

  if [ -z "$rel_path" ]; then
    # Not in map — use relative path from downloads dir
    rel_path=$(echo "$src_file" | sed "s|^$DOWNLOADS_DIR/||")
  fi

  for target in "$TARGET_1" "$TARGET_2"; do
    dest="$target/$rel_path"
    dest_dir=$(dirname "$dest")

    if [ ! -d "$target" ]; then
      echo "  SKIP $target (dir not found)"
      skipped=$((skipped + 1))
      continue
    fi

    if $DRY_RUN; then
      echo "  WOULD COPY $fname -> $dest"
    else
      mkdir -p "$dest_dir"
      if cp "$src_file" "$dest" 2>/dev/null; then
        echo "  OK   $fname -> $dest"
        copied=$((copied + 1))
      else
        echo "  FAIL $fname -> $dest"
        errors=$((errors + 1))
      fi
    fi
  done
done

echo ""
if $DRY_RUN; then
  echo "Dry run complete. Run without --dry-run to copy files."
else
  echo "Done. Copied: $copied  Skipped: $skipped  Errors: $errors"
fi
