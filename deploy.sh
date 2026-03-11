#!/bin/bash
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
# Mapping: filename → relative path inside the project
# ============================================================
declare -A FILE_MAP=(
  # Root-level files
  ["server.js"]="server.js"
  ["db.js"]="db.js"
  ["mock-data.js"]="mock-data.js"
  ["package.json"]="package.json"
  ["config.example.json"]="config.example.json"
  ["start.sh"]="start.sh"
  ["start.bat"]="start.bat"
  ["start-mock.sh"]="start-mock.sh"
  ["deploy.sh"]="deploy.sh"

  # public/
  ["index.html"]="public/index.html"
  ["styles.css"]="public/css/styles.css"
  ["app.js"]="public/js/app.js"
  ["api.js"]="public/js/api.js"
  ["ui.js"]="public/js/ui.js"
)

# ============================================================
DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN — no files will be copied ==="
  echo ""
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

copied=0
skipped=0
errors=0

# Check downloads dir
if [[ ! -d "$DOWNLOADS_DIR" ]]; then
  echo -e "${RED}ERROR: Downloads directory not found: $DOWNLOADS_DIR${NC}"
  exit 1
fi

echo "Source:   $DOWNLOADS_DIR"
echo "Target 1: $TARGET_1"
echo "Target 2: $TARGET_2"
echo ""

# Find all files in downloads dir (flat or nested)
while IFS= read -r src_file; do
  basename=$(basename "$src_file")

  # Look up the relative path from FILE_MAP
  rel_path="${FILE_MAP[$basename]}"

  if [[ -z "$rel_path" ]]; then
    # Not in map — try to use relative path from downloads dir
    rel_path="${src_file#$DOWNLOADS_DIR/}"
  fi

  for target in "$TARGET_1" "$TARGET_2"; do
    dest="$target/$rel_path"
    dest_dir=$(dirname "$dest")

    if [[ ! -d "$target" ]]; then
      echo -e "  ${YELLOW}SKIP${NC} $target (dir not found)"
      ((skipped++))
      continue
    fi

    if $DRY_RUN; then
      echo -e "  ${GREEN}WOULD COPY${NC} $basename → $dest"
    else
      mkdir -p "$dest_dir"
      if cp "$src_file" "$dest" 2>/dev/null; then
        echo -e "  ${GREEN}OK${NC} $basename → $dest"
        ((copied++))
      else
        echo -e "  ${RED}FAIL${NC} $basename → $dest"
        ((errors++))
      fi
    fi
  done

done < <(find "$DOWNLOADS_DIR" -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.json" -o -name "*.sh" -o -name "*.bat" \) ! -name ".*")

echo ""
if $DRY_RUN; then
  echo "Dry run complete. Run without --dry-run to copy files."
else
  echo -e "Done. Copied: ${GREEN}$copied${NC}  Skipped: ${YELLOW}$skipped${NC}  Errors: ${RED}$errors${NC}"
fi
