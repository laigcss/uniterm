#!/usr/bin/env bash
# build-linux.sh — Build uniTerm for Linux (amd64/arm64) using upstream wails3 task
# Usage: ./scripts/build-linux.sh [ARCH=amd64|arm64] [VERSION=<ver>] [--package] [--clean]
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

OS_TYPE="$(uname -s)"
if [[ "$OS_TYPE" == "Darwin" ]]; then
  if ! command -v docker &>/dev/null; then
    echo "ERROR: docker not found (required for Linux cross-compilation on macOS)." >&2
    echo "  Install Docker Desktop, then run: wails3 task setup:docker" >&2; exit 2
  fi
fi

if [[ -z "$VERSION" ]] && [[ -f "$SCRIPT_DIR/version.sh" ]]; then
  VERSION="$("$SCRIPT_DIR/version.sh" read)"
fi
[[ -z "$VERSION" ]] && VERSION="dev"

echo "Building uniTerm for Linux | ARCH=$ARCH | VERSION=$VERSION | PACKAGE=$DO_PACKAGE | HOST=$OS_TYPE"

[[ "$DO_CLEAN" == true ]] && rm -rf bin/

wails3 task linux:build VERSION="$VERSION" ARCH="$ARCH"

if [[ "$DO_PACKAGE" == true ]]; then
  if command -v nfpm &>/dev/null; then
    wails3 task linux:package VERSION="$VERSION" ARCH="$ARCH"
  else
    echo "WARN: nfpm not found. Skipping deb/rpm. Binary built successfully." >&2
  fi
fi

echo "Build complete! Products in bin/:"
ls -lh bin/uniterm* 2>/dev/null || true