#!/usr/bin/env bash
# build-all.sh — Unified build entry point for uniTerm
# Usage: ./scripts/build-all.sh <platform> [OPTIONS]
# Platforms: windows | linux | android | harmonyos | mac
# Options:   ARCH=<arch> VERSION=<ver> --package --clean
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

PLATFORM="${1:-}"
if [[ -z "$PLATFORM" ]]; then
  echo "Usage: $0 <windows|linux|android|harmonyos|mac> [ARCH=<arch>] [VERSION=<ver>] [--package] [--clean]"
  exit 1
fi
shift

export PATH="$HOME/go/bin:/opt/homebrew/bin:$PATH"

# Determine version
VERSION=""
for arg in "$@"; do
  case "$arg" in VERSION=*) VERSION="${arg#VERSION=}" ;; esac
done
if [[ -z "$VERSION" ]] && [[ -f "$SCRIPT_DIR/version.sh" ]]; then
  VERSION="$("$SCRIPT_DIR/version.sh" read)"
fi
[[ -z "$VERSION" ]] && VERSION="dev"

echo "=========================================="
echo "uniTerm unified build"
echo "  Platform: $PLATFORM"
echo "  Version:  $VERSION"
echo "=========================================="

START_TIME=$(date +%s)

case "$PLATFORM" in
  windows)
    "$SCRIPT_DIR/build-windows.sh" "$@"
    ;;
  linux)
    "$SCRIPT_DIR/build-linux.sh" "$@"
    ;;
  android)
    "$SCRIPT_DIR/build-android.sh" "$@"
    ;;
  harmonyos)
    # Source signing environment
    if [[ -f "$PROJECT_ROOT/harmonyos/sign-env" ]]; then
      source "$PROJECT_ROOT/harmonyos/sign-env"
    fi
    if [[ -z "${HARMONYOS_STORE_PASSWORD:-}" ]] || [[ -z "${HARMONYOS_KEY_PASSWORD:-}" ]]; then
      echo "ERROR: HARMONYOS_STORE_PASSWORD/HARMONYOS_KEY_PASSWORD not set." >&2
      echo "  Copy harmonyos/sign-env.example to harmonyos/sign-env and fill in values." >&2
      exit 2
    fi
    # Substitute placeholders in build-profile.json5
    PROFILE="$PROJECT_ROOT/harmonyos/build-profile.json5"
    cp "$PROFILE" "$PROFILE.bak"
    sed -i.bak2 "s/@@HARMONYOS_STORE_PASSWORD@@/$HARMONYOS_STORE_PASSWORD/g; s/@@HARMONYOS_KEY_PASSWORD@@/$HARMONYOS_KEY_PASSWORD/g" "$PROFILE"
    trap 'mv "$PROFILE.bak" "$PROFILE"' EXIT
    "$SCRIPT_DIR/build-harmonyos.sh" "$@"
    ;;
  mac)
    wails3 task darwin:package VERSION="$VERSION"
    ;;
  *)
    echo "ERROR: Unknown platform '$PLATFORM'" >&2
    echo "Supported: windows | linux | android | harmonyos | mac" >&2
    exit 1
    ;;
esac

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo ""
echo "=========================================="
echo "Build complete in ${ELAPSED}s"
echo "=========================================="