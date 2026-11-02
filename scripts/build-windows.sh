#!/usr/bin/env bash
# build-windows.sh — Build uniTerm for Windows (amd64/arm64) using upstream wails3 task
# Usage: ./scripts/build-windows.sh [ARCH=amd64|arm64] [VERSION=<ver>] [--package] [--clean]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ARCH="amd64"; VERSION=""; DO_PACKAGE=false; DO_CLEAN=false
for arg in "$@"; do
  case "$arg" in
    ARCH=*) ARCH="${arg#ARCH=}" ;;
    VERSION=*) VERSION="${arg#VERSION=}" ;;
    --package) DO_PACKAGE=true ;;
    --clean) DO_CLEAN=true ;;
  esac
done

export PATH="$HOME/go/bin:$PATH"

if ! command -v wails3 &>/dev/null; then
  echo "ERROR: wails3 not found." >&2; exit 2
fi
if [[ "$DO_PACKAGE" == true ]] && ! command -v makensis &>/dev/null; then
  echo "ERROR: makensis not found (required for --package)." >&2; exit 2
fi

if [[ -z "$VERSION" ]] && [[ -f "$SCRIPT_DIR/version.sh" ]]; then
  VERSION="$("$SCRIPT_DIR/version.sh" read)"
fi
[[ -z "$VERSION" ]] && VERSION="dev"

echo "Building uniTerm for Windows | ARCH=$ARCH | VERSION=$VERSION | PACKAGE=$DO_PACKAGE"

[[ "$DO_CLEAN" == true ]] && rm -rf bin/

wails3 task windows:build VERSION="$VERSION" ARCH="$ARCH"

if [[ "$DO_PACKAGE" == true ]]; then
  wails3 task windows:package VERSION="$VERSION"
fi

echo "Build complete! Products in bin/:"
ls -lh bin/*.exe 2>/dev/null || true