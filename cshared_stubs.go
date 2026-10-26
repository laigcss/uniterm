//go:build cshared

// cshared_stubs.go — Provides no-op stubs for GUI symbols that are defined
// in main.go (excluded via //go:build !cshared) but still referenced by
// app.go and app_darwin.go in c-shared (HarmonyOS) builds.
//
// In cshared mode there is no window, tray icon, or global hotkey — these
// stubs allow the code to compile without pulling in any GUI dependencies.

package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/ys-ll/uniterm/backend/store"
)

// devBuild is always false in cshared mode (production shared library).
var devBuild = false

// appIconTrayPNG / appIconTrayTemplatePNG are empty in cshared mode (no tray).
var appIconTrayPNG []byte
var appIconTrayTemplatePNG []byte

// showMainWindow is a no-op in cshared mode (no GUI window).
func showMainWindow(window *application.WebviewWindow) {}

// applyGlobalShowHideHotkey is a no-op in cshared mode (no global hotkey).
func applyGlobalShowHideHotkey(w3app *application.App, window *application.WebviewWindow, binding *store.KeyBinding) {
}

// trayHotkeyBinding returns nil in cshared mode (no tray hotkey).
func trayHotkeyBinding(s *store.AppSettings) *store.KeyBinding {
	return nil
}

// refreshTrayLanguage is a no-op in cshared mode (no tray icon to rebuild).
// The real implementation lives in main.go (excluded via //go:build !cshared);
// this stub satisfies the call from App.SaveSettings (issue #1215) so the
// c-shared HarmonyOS build compiles.
func (a *App) refreshTrayLanguage(lang string) {}
