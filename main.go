package main

import (
	"embed"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"

	// F-201: register pprof handlers on the default mux.
	_ "net/http/pprof"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/ys-ll/uniterm/backend/log"
	"github.com/ys-ll/uniterm/backend/store"
)

var Version = "dev"

// devBuild is true for `wails dev` (Version == "dev"); false for production
// builds where `-ldflags '-X main.Version=...'` sets a real version string.
// Used to gate the pprof HTTP listener so production binaries don't open it.
var devBuild = Version == "dev"

//go:embed all:frontend/dist
var assets embed.FS

// Linux desktop icon, embedded so a bare binary (no deb/rpm) can register its
// own desktop integration at startup instead of relying on installation.
//
//go:embed build/appicon.png
var linuxAppIcon []byte

func main() {
	// Capture top-level panics
	defer func() {
		if r := recover(); r != nil {
			_ = log.Init()
			log.Writef("FATAL PANIC: %v\n%s", r, string(debug.Stack()))
			log.Close()
			os.Exit(1)
		}
	}()

	if err := log.Init(); err != nil {
		println("Failed to init log:", err.Error())
	}
	defer log.Close()

	// F-201: expose net/http/pprof on localhost:6060 for dev builds only.
	// Production builds (wails build) leave Version unchanged from "dev"
	// unless ldflags set it; gate behind a build flag so production does
	// not open a listener.
	startPprofIfDev()

	webviewDataPath := filepath.Join(os.TempDir(), fmt.Sprintf("uniTerm-webview2-%d", os.Getpid()))
	os.MkdirAll(webviewDataPath, 0700)

	app := NewApp(webviewDataPath)

	// Linux multi-monitor maximize workaround:
	// Wails sets default max size to primary display, which can clamp
	// maximize on secondary monitors. Set to large values to disable.
	// See: https://github.com/wailsapp/wails/issues/2431
	maxW, maxH := 0, 0
	if runtime.GOOS == "linux" {
		maxW, maxH = 9999, 9999

		// Linux desktop integration: deb/rpm installs place a .desktop entry in
		// the XDG data dirs, so the dock/launcher icon comes from there. For a
		// bare binary that is never installed, register the entry into the
		// user's home so the app still shows an icon when launched directly.
		if exe, err := os.Executable(); err == nil {
			ensureLinuxDesktopIntegration(exe)
		}
	}

	// On macOS, install the standard App + Edit menus. The Edit menu is what
	// routes the native Cmd+C/V/X/A/Z shortcuts to the first responder — every
	// WKWebView text field (input/textarea/contenteditable) relies on it. An
	// empty menu here used to suppress Wails' defaults but also killed those
	// shortcuts app-wide, forcing per-component JS reimplementations. The menu
	// lives in the top system menu bar, so it doesn't affect the frameless
	// window. On Linux (GTK) a non-nil Menu creates an empty GtkMenuBar that
	// shows as a thin white line in the frameless window, so leave it nil
	// there. See issue #291.
	var appMenu *application.Menu
	if runtime.GOOS == "darwin" {
		appMenu = application.NewMenu()
		appMenu.AddRole(application.AppMenu)
		appMenu.AddRole(application.EditMenu)
	}

	// Read persisted window geometry before creating the window — it's fixed at
	// creation in v3 (services start before the window exists, so ServiceStartup
	// can't position it). Race the load against a short timeout so a slow disk
	// doesn't delay first paint.
	systemTitleBar := false
	winW, winH := 1200, 800 // fallback before any saved geometry is applied
	savedX, savedY := 0, 0
	savedMaxed := false
	if configDir, err := os.UserConfigDir(); err == nil {
		ls := store.NewLocalStateStore(filepath.Join(configDir, "uniTerm"))
		done := make(chan store.LocalState, 1)
		go func() {
			if state, err := ls.Load(); err == nil {
				done <- state
				return
			}
			done <- store.LocalState{}
		}()
		select {
		case state := <-done:
			systemTitleBar = state.SystemTitleBar
			if state.WindowWidth > 0 && state.WindowHeight > 0 {
				winW, winH = state.WindowWidth, state.WindowHeight
			}
			savedX, savedY = state.WindowX, state.WindowY
			savedMaxed = state.WindowMaximised
		case <-time.After(100 * time.Millisecond):
			// Slow disk — paint the defaults. The goroutine continues to load
			// in the background; its result is discarded because the window
			// geometry options are fixed at startup.
		}
	}

	// Restore a saved position only when one actually exists; otherwise keep v3's
	// default (centered) so a fresh install doesn't land at (0,0).
	startPos := application.WindowCentered
	if savedX != 0 || savedY != 0 {
		startPos = application.WindowXY
	}
	startState := application.WindowStateNormal
	if savedMaxed {
		startState = application.WindowStateMaximised
	}

	macTitleBar := application.MacTitleBarHiddenInset
	if systemTitleBar {
		macTitleBar = application.MacTitleBarDefault
	}

	w3app := application.New(application.Options{
		Name:       "uniTerm",
		Assets:     application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		OnShutdown: app.shutdown,
		// WebviewUserDataPath is a Windows-only path for WebView2 user data; it is
		// harmless (ignored) on other platforms.
		Windows: application.WindowsOptions{
			WebviewUserDataPath: webviewDataPath,
		},
		// Fixed program name so the window's WM_CLASS stays "uniterm" — the
		// .desktop files (installed or self-registered) set StartupWMClass to the
		// same value, which is what lets the dock/taskbar associate the running
		// window with the app icon.
		Linux: application.LinuxOptions{
			ProgramName: "uniterm",
		},
	})

	if appMenu != nil {
		w3app.Menu.SetApplicationMenu(appMenu)
	}

	window := w3app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:           "uniTerm",
		Width:           winW,
		Height:          winH,
		X:               savedX,
		Y:               savedY,
		InitialPosition: startPos,
		StartState:      startState,
		MinWidth:        700,
		MinHeight:       450,
		MaxWidth:        maxW,
		MaxHeight:       maxH,
		Frameless:       runtime.GOOS != "darwin" && !systemTitleBar,
		BackgroundColour: application.RGBA{
			Red: 27, Green: 38, Blue: 54, Alpha: 1,
		},
		EnableFileDrop: true,
		Mac: application.MacWindow{
			TitleBar: macTitleBar,
		},
	})

	// Wails v3 delivers OS file drops to Go-side window-event listeners rather
	// than (as v2 did) auto-forwarding them to the frontend. Re-emit the dropped
	// absolute paths under the original v2 event name so `Events.On(...)` pickers
	// (FileSidebar, SFTP tab) keep receiving them for path-based upload.
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		filenames := event.Context().DroppedFiles()
		if len(filenames) == 0 {
			return
		}
		x, y, elementID := 0, 0, ""
		if details := event.Context().DropTargetDetails(); details != nil {
			x, y = details.X, details.Y
			elementID = details.ElementID
		}
		w3app.Event.Emit("common:WindowFilesDropped", map[string]any{
			"x":         x,
			"y":         y,
			"elementId": elementID,
			"filenames": filenames,
		})
	})

	// Wire the bound App back to the runtime before registering it as a service:
	// emit() / window operations route through these references.
	app.app = w3app
	app.window = window
	w3app.RegisterService(application.NewService(app))

	err := w3app.Run()
	if err != nil {
		log.Writef("Wails run error: %v", err)
	}
}

// startPprofIfDev spawns a goroutine that serves net/http/pprof on
// localhost:6060 — only when running a dev build. Production builds
// (Version != "dev") deliberately skip this so end-users never have
// the debug listener open.
//
// The listener stays up for the lifetime of the process; its only job
// is to let `go tool pprof http://localhost:6060/debug/pprof/profile`
// connect and capture CPU/heap/block/goroutine profiles during
// reproduction of perf issues (see F-201 / audit §8.2).
func startPprofIfDev() {
	if !devBuild {
		return
	}
	go func() {
		if err := http.ListenAndServe("localhost:6060", nil); err != nil && err != http.ErrServerClosed {
			log.Writef("pprof listener failed: %v", err)
		}
	}()
}

// linuxDesktopEntry is the [Desktop Entry] file written for a self-registered
// (bare binary) install. Exec is filled with the running binary's path.
const linuxDesktopEntry = `[Desktop Entry]
Name=uniTerm
Comment=Lightweight All-in-One Terminal Emulator
Exec=%s
Icon=uniTerm
Terminal=false
Type=Application
Categories=System;TerminalEmulator;
StartupWMClass=uniterm
`

// ensureLinuxDesktopIntegration registers a bare Linux binary into the user's
// desktop environment so the dock/launcher shows an icon when the app is run
// without being installed (deb/rpm). Desktop handlers (GNOME Shell, KDE, XFCE
// Panel, file managers) only associate a running window with an icon through a
// .desktop entry matched by StartupWMClass; GTK4/Wails has no runtime API to
// set a window icon directly.
//
// Entries already present in the XDG data dirs (i.e. an installed package)
// take precedence — in that case we do nothing rather than overwriting them.
// Writing happens on the user's home ("portable app" / AppImage convention).
func ensureLinuxDesktopIntegration(execPath string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	if linuxDesktopRegistered(home) {
		return
	}

	appsDir := filepath.Join(home, ".local/share/applications")
	iconDir := filepath.Join(home, ".local/share/icons/hicolor/128x128/apps")
	os.MkdirAll(appsDir, 0700)
	os.MkdirAll(iconDir, 0700)

	desktopPath := filepath.Join(appsDir, "uniTerm.desktop")
	iconPath := filepath.Join(iconDir, "uniTerm.png")

	if err := os.WriteFile(desktopPath, []byte(fmt.Sprintf(linuxDesktopEntry, execPath)), 0644); err != nil {
		log.Writef("linux desktop integration: write %s failed: %v", desktopPath, err)
		return
	}
	if err := os.WriteFile(iconPath, linuxAppIcon, 0644); err != nil {
		log.Writef("linux desktop integration: write %s failed: %v", iconPath, err)
		return
	}

	// Best-effort refresh so the entry is picked up without a re-login. These
	// tools may be missing/wrong on some distros; failures are not fatal.
	exec.Command("update-desktop-database", appsDir).Run()
	exec.Command("gtk-update-icon-cache", "-t", "-f", filepath.Join(home, ".local/share/icons/hicolor")).Run()
}

// linuxDesktopRegistered reports whether a uniTerm.desktop entry already exists
// in any XDG data directory (system dirs from XDG_DATA_DIRS/defaults, plus the
// user-level dir). An installed deb/rpm satisfies this, so a bare binary skips
// self-registration and lets the packaged entry win.
func linuxDesktopRegistered(home string) bool {
	dataDirs := os.Getenv("XDG_DATA_DIRS")
	if dataDirs == "" {
		dataDirs = "/usr/local/share:/usr/share"
	}
	for _, dir := range filepath.SplitList(dataDirs) {
		if p, err := os.Stat(filepath.Join(dir, "applications", "uniTerm.desktop")); err == nil && !p.IsDir() {
			return true
		}
	}
	if p, err := os.Stat(filepath.Join(home, ".local/share/applications", "uniTerm.desktop")); err == nil && !p.IsDir() {
		return true
	}
	return false
}
