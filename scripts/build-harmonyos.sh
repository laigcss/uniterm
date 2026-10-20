#!/usr/bin/env bash
#
# build-harmonyos.sh
#
# Full HarmonyOS cross-compile pipeline for uniTerm.
#
# This script automates the entire build flow:
#   1. Build frontend (vite build)
#   2. Sync frontend dist → harmonyos rawfile
#   3. Re-apply Wails vendor build constraints (in case go mod vendor reset them)
#   4. Cross-compile Go c-shared library (GOOS=android, arm64-v8a)
#   5. (Optional) Build HarmonyOS HAP via hmosBuild
#   6. (Optional) Deploy to device via hdc
#
# Usage:
#   ./scripts/build-harmonyos.sh                  # full build (steps 1-4)
#   ./scripts/build-harmonyos.sh --deploy         # build + HAP + deploy
#   ./scripts/build-harmonyos.sh --skip-frontend  # skip frontend rebuild
#   ./scripts/build-harmonyos.sh --check-only     # just verify constraints
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Configuration ---
HARMONYOS_DIR="$PROJECT_ROOT/harmonyos"
NDK="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native"
HDC="/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc"
DEVICE_ADDR="127.0.0.1:5555"
GO_LIB_DIR="$HARMONYOS_DIR/entry/libs/arm64-v8a"
GO_LIB_NAME="libaiops.so"
RAWFILE_DIR="$HARMONYOS_DIR/entry/src/main/resources/rawfile/frontend"

# --- Parse args ---
DEPLOY=false
SKIP_FRONTEND=false
CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --deploy)       DEPLOY=true ;;
    --skip-frontend) SKIP_FRONTEND=true ;;
    --check-only)   CHECK_ONLY=true ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }

# --- Step 0: Check Wails vendor build constraints ---
log "Step 0: Verifying Wails vendor build constraints..."
"$SCRIPT_DIR/apply-wails-build-constraints.sh" --check
if [[ $? -ne 0 ]]; then
  warn "Constraints not satisfied. Auto-patching..."
  "$SCRIPT_DIR/apply-wails-build-constraints.sh"
fi
ok "Build constraints verified"

if $CHECK_ONLY; then
  log "Check-only mode: exiting after constraint verification."
  exit 0
fi

# --- Step 1: Build frontend ---
if ! $SKIP_FRONTEND; then
  log "Step 1: Building frontend (vite build)..."
  cd "$PROJECT_ROOT/frontend"
  npx vite build
  ok "Frontend built → frontend/dist"

  # --- Step 2: Sync to rawfile ---
  log "Step 2: Syncing frontend dist → harmonyos rawfile..."
  mkdir -p "$RAWFILE_DIR"
  cp -r "$PROJECT_ROOT/frontend/dist/"* "$RAWFILE_DIR/"
  ok "Rawfile synced → $RAWFILE_DIR"
else
  warn "Skipping frontend build (--skip-frontend)"
fi

# --- Step 3: Cross-compile Go c-shared library ---
log "Step 3: Cross-compiling Go c-shared library (GOOS=android arm64)..."

if [[ ! -d "$NDK" ]]; then
  fail "HarmonyOS NDK not found at: $NDK"
  exit 1
fi

CC="$NDK/llvm/bin/clang --target=aarch64-linux-ohos --sysroot=$NDK/sysroot"
mkdir -p "$GO_LIB_DIR"

cd "$PROJECT_ROOT"

# Clean previous build
rm -f "$GO_LIB_DIR/$GO_LIB_NAME" "$GO_LIB_DIR/${GO_LIB_NAME%.so}.h"

GOOS=android GOARCH=arm64 CGO_ENABLED=1 \
  CC="$CC" \
  CGO_LDFLAGS="-L/tmp" \
  go build -mod=vendor -buildmode=c-shared -tags server,cshared \
  -trimpath -ldflags="-w -s" \
  -o "$GO_LIB_DIR/$GO_LIB_NAME" .

if [[ ! -f "$GO_LIB_DIR/$GO_LIB_NAME" ]]; then
  fail "Go library not built"
  exit 1
fi

LIB_SIZE=$(du -h "$GO_LIB_DIR/$GO_LIB_NAME" | cut -f1)
ok "Go library built → $GO_LIB_DIR/$GO_LIB_NAME ($LIB_SIZE)"

# --- Step 4 (optional): Build HAP ---
if $DEPLOY; then
  log "Step 4: Building HarmonyOS HAP (debug)..."

  # Check stub liblog.so
  if [[ ! -f "$GO_LIB_DIR/liblog.so" ]]; then
    warn "liblog.so stub not found. Creating minimal stub..."
    # This should already exist in the repo; warn if missing
    warn "Please ensure harmonyos/entry/libs/arm64-v8a/liblog.so exists"
  fi

  # Use hmosBuild if available
  if command -v hmosBuild &>/dev/null; then
    hmosBuild project="$HARMONYOS_DIR" mode=debug clean=true
    ok "HAP built"
  else
    warn "hmosBuild not found in PATH. Please build via DevEco Studio."
    warn "Open: $HARMONYOS_DIR"
  fi

  # --- Step 5: Deploy to device ---
  log "Step 5: Deploying to device ($DEVICE_ADDR)..."

  if [[ ! -x "$HDC" ]]; then
    fail "hdc not found at: $HDC"
    exit 1
  fi

  # Find the built HAP
  HAP_FILE=$(find "$HARMONYOS_DIR" -name "*.hap" -path "*/debug/*" | head -1)
  if [[ -z "$HAP_FILE" ]]; then
    HAP_FILE=$(find "$HARMONYOS_DIR" -name "*.hap" | head -1)
  fi

  if [[ -z "$HAP_FILE" ]]; then
    fail "No .hap file found"
    exit 1
  fi

  log "Deploying: $HAP_FILE"

  # Connect to device
  "$HDC" tconn "$DEVICE_ADDR" || true

  # Install
  "$HDC" install "$HAP_FILE"
  ok "HAP installed"

  # Launch (bundle name may need adjustment)
  BUNDLE_NAME="com.uniterm.app"
  ABILITY_NAME="EntryAbility"
  "$HDC" shell aa start -a "$ABILITY_NAME" -b "$BUNDLE_NAME"
  ok "App launched on device"
fi

echo ""
log "=== Build Complete ==="
ok "Go library: $GO_LIB_DIR/$GO_LIB_NAME"
if $DEPLOY; then
  ok "Deployed to: $DEVICE_ADDR"
fi