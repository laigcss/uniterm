#!/usr/bin/env bash
#
# apply-wails-build-constraints.sh
#
# Re-applies Wails vendor build-constraint patches after `go mod vendor` resets
# them.  This is needed because `go mod vendor` copies files verbatim from the
# upstream module, discarding our `&& !server` / `|| server` additions that
# allow the same vendor tree to compile in both desktop (android) and server
# (GOOS=android -tags server) modes.
#
# Run this script:
#   1. After every `go mod vendor` or `go mod tidy` that touches vendor/
#   2. Before any HarmonyOS cross-compile that uses -mod=vendor
#   3. Manually if you suspect the constraints have been reset
#
# Usage:
#   ./scripts/apply-wails-build-constraints.sh          # patch + verify
#   ./scripts/apply-wails-build-constraints.sh --check   # verify only (CI)
#
# Exit codes:
#   0  all constraints are correct (or successfully patched)
#   1  some constraints could not be patched
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WAILS_APP_DIR="$PROJECT_ROOT/vendor/github.com/wailsapp/wails/v3/pkg/application"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
fi

if [[ ! -d "$WAILS_APP_DIR" ]]; then
  echo -e "${RED}Error: Wails vendor directory not found at:$NC"
  echo "  $WAILS_APP_DIR"
  echo "  Run 'go mod vendor' first."
  exit 1
fi

echo "=== Wails Vendor Build-Constraint Patcher ==="
echo "Target: $WAILS_APP_DIR"
echo "Mode:   $(if $CHECK_ONLY; then echo "check-only"; else echo "patch"; fi)"
echo ""

#
# --- Android files: add `&& !server` to `//go:build android` ---
#
# These files contain Android-specific GUI code (JNI, Looper, etc.) that must
# NOT compile in server mode, even when GOOS=android.  The `!server` tag
# excludes them when `-tags server` is set.
#
ANDROID_FILES=(
  application_android.go
  autostart_android.go
  clipboard_android.go
  dialogs_android.go
  events_common_android.go
  init_android.go
  keys_android.go
  logger_android.go
  mainthread_android.go
  menu_android.go
  menuitem_android.go
  messageprocessor_android.go
  mobile_android.go
  mobile_features_android.go
  screen_android.go
  signal_handler_android.go
  signal_handler_types_android.go
  single_instance_android.go
  systemtray_android.go
  webview_window_android.go
)

#
# --- Desktop/stub files: add `|| server` to `!ios && !android` ---
#
# These files contain desktop fallbacks for mobile-only features.  In server
# mode (GOOS=android -tags server) the android files are excluded, so these
# desktop stubs MUST compile to provide the missing symbols.
#
# Pattern: `//go:build !ios && !android` → `//go:build (!ios && !android) || server`
#
DESKTOP_FILES=(
  messageprocessor_mobile_stub.go
  mobile_stub.go
  signal_handler_desktop.go
)

errors=0
patched=0
already_ok=0

# --- Patch android files ---
for f in "${ANDROID_FILES[@]}"; do
  filepath="$WAILS_APP_DIR/$f"
  if [[ ! -f "$filepath" ]]; then
    echo -e "${YELLOW}WARN: $f not found (skipping)${NC}"
    continue
  fi

  first_line=$(head -1 "$filepath")

  # Check if already patched (contains !server)
  if echo "$first_line" | grep -q '!server'; then
    already_ok=$((already_ok + 1))
    continue
  fi

  # Check if it's the unpatched `//go:build android` or `//go:build android && cgo`
  if echo "$first_line" | grep -qE '^//go:build android(&& cgo)?$'; then
    if $CHECK_ONLY; then
      echo -e "${RED}FAIL: $f has unpatched constraint: $first_line${NC}"
      errors=$((errors + 1))
      continue
    fi
    # Patch it: add `&& !server`
    new_line="${first_line} && !server"
    # Replace only the first line (portable: works on both BSD and GNU sed)
    tmpfile=$(mktemp)
    echo "$new_line" > "$tmpfile"
    tail -n +2 "$filepath" >> "$tmpfile"
    mv "$tmpfile" "$filepath"
    patched=$((patched + 1))
    echo -e "${GREEN}PATCHED: $f${NC} → $new_line"
  else
    echo -e "${YELLOW}WARN: $f has unexpected constraint: $first_line${NC}"
    errors=$((errors + 1))
  fi
done

# --- Patch desktop/stub files ---
for f in "${DESKTOP_FILES[@]}"; do
  filepath="$WAILS_APP_DIR/$f"
  if [[ ! -f "$filepath" ]]; then
    echo -e "${YELLOW}WARN: $f not found (skipping)${NC}"
    continue
  fi

  first_line=$(head -1 "$filepath")

  # Check if already patched (contains server)
  if echo "$first_line" | grep -q 'server'; then
    already_ok=$((already_ok + 1))
    continue
  fi

  # Check if it's the unpatched `//go:build !ios && !android`
  if echo "$first_line" | grep -q '^//go:build !ios && !android$'; then
    if $CHECK_ONLY; then
      echo -e "${RED}FAIL: $f has unpatched constraint: $first_line${NC}"
      errors=$((errors + 1))
      continue
    fi
    # Patch it: wrap in parens and add || server
    new_line="//go:build (!ios && !android) || server"
    tmpfile=$(mktemp)
    echo "$new_line" > "$tmpfile"
    tail -n +2 "$filepath" >> "$tmpfile"
    mv "$tmpfile" "$filepath"
    patched=$((patched + 1))
    echo -e "${GREEN}PATCHED: $f${NC} → $new_line"
  else
    echo -e "${YELLOW}WARN: $f has unexpected constraint: $first_line${NC}"
    errors=$((errors + 1))
  fi
done

# --- Summary ---
echo ""
echo "=== Summary ==="
echo "Already OK: $already_ok files"
echo "Patched:    $patched files"
echo "Errors:     $errors files"
echo ""

if [[ $errors -gt 0 ]]; then
  echo -e "${RED}FAILED: Some constraints could not be patched.${NC}"
  exit 1
fi

if $CHECK_ONLY; then
  if [[ $patched -gt 0 ]]; then
    echo -e "${RED}FAILED: $patched files need patching. Run without --check to fix.${NC}"
    exit 1
  fi
  echo -e "${GREEN}OK: All build constraints are correct.${NC}"
else
  if [[ $patched -gt 0 ]]; then
    echo -e "${GREEN}Success: $patched files patched.${NC}"
  else
    echo -e "${GREEN}Success: All constraints were already correct.${NC}"
  fi
fi

exit 0