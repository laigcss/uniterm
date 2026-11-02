#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_ROOT/build/config.yml"

parse_version() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "ERROR: config.yml not found at $CONFIG_FILE" >&2
    exit 1
  fi
  local ver
  ver=$(sed -n 's/.*version:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG_FILE" | head -1)
  if [[ -z "$ver" ]]; then
    echo "ERROR: version field not found in $CONFIG_FILE" >&2
    exit 1
  fi
  echo "$ver"
}

calc_code() {
  local ver="$1"
  local major minor patch
  major=$(echo "$ver" | awk -F. '{print $1+0}')
  minor=$(echo "$ver" | awk -F. '{print ($2==""?0:$2)+0}')
  patch=$(echo "$ver" | awk -F. '{print ($3==""?0:$3)+0}')
  echo $((major * 10000 + minor * 100 + patch))
}

case "${1:-}" in
  read|name) parse_version ;;
  code) calc_code "$(parse_version)" ;;
  *) echo "Usage: $0 {read|name|code}" >&2; exit 1 ;;
esac