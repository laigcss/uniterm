#!/usr/bin/env bash
# build-android.sh — Build uniTerm for Android (arm64/amd64/fat) using upstream wails3 task
# Usage: ./scripts/build-android.sh [ARCH=arm64|amd64|fat] [VERSION=<ver>] [--clean]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ARCH="arm64"; VERSION=""; DO_CLEAN=false
for arg in "$@"; do
  case "$arg" in
    ARCH=*) ARCH="${arg#ARCH=}" ;;
    VERSION=*) VERSION="${arg#VERSION=}" ;;
    --clean) DO_CLEAN=true ;;
  esac
done

export PATH="$HOME/go/bin:$PATH"

if ! command -v wails3 &>/dev/null; then
  echo "ERROR: wails3 not found." >&2; exit 2
fi

# Check JDK
if ! command -v java &>/dev/null; then
  echo "ERROR: java not found. JDK 21+ required." >&2; exit 2
fi
JAVA_VER=$(java -version 2>&1 | head -1 | sed 's/.*version "\([0-9]*\).*/\1/')
if [[ "${JAVA_VER:-0}" -lt 21 ]]; then
  echo "WARN: JDK $JAVA_VER detected, upstream requires JDK 21+." >&2
fi

# Check Android SDK
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "ERROR: Android SDK not found. Set ANDROID_HOME or install to ~/Library/Android/sdk" >&2; exit 2
fi
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# Check NDK
NDK_DIR="${ANDROID_NDK_HOME:-}"
if [[ -z "$NDK_DIR" ]]; then
  NDK_DIR=$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | head -1 || true)
fi
if [[ -z "$NDK_DIR" ]] || [[ ! -d "$NDK_DIR" ]]; then
  echo "ERROR: Android NDK not found." >&2
  echo "  Install: sdkmanager 'ndk;26.3.11579264'" >&2; exit 2
fi
export ANDROID_NDK_HOME="$NDK_DIR"

if [[ -z "$VERSION" ]] && [[ -f "$SCRIPT_DIR/version.sh" ]]; then
  VERSION="$("$SCRIPT_DIR/version.sh" read)"
fi
[[ -z "$VERSION" ]] && VERSION="dev"

echo "Building uniTerm for Android | ARCH=$ARCH | VERSION=$VERSION"

[[ "$DO_CLEAN" == true ]] && rm -rf bin/

case "$ARCH" in
  fat) wails3 task android:package:fat VERSION="$VERSION" ;;
  amd64) wails3 task android:package VERSION="$VERSION" ARCH=amd64 ;;
  *) wails3 task android:package VERSION="$VERSION" ;;
esac

echo "Build complete! Products in bin/:"
ls -lh bin/*.apk 2>/dev/null || true