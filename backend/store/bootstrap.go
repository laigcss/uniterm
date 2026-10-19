//go:build !android

package store

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/ys-ll/uniterm/backend/log"
)

// AutoInitMode is set by the c-shared entry point to indicate that the
// data directory should be auto-initialized without showing a dialog.
// This bypasses environment variable issues in c-shared mode where C's
// setenv may not be visible to Go's os.Getenv.
var AutoInitMode bool

// DataDirRoot is set by the c-shared entry point to provide the data directory
// path directly, bypassing os.UserConfigDir() which may fail if XDG_CONFIG_HOME
// is not visible to Go in c-shared mode.
var DataDirRoot string

const bootstrapFileName = "bootstrap.json"

type bootstrap struct {
	Type    string `json:"type"`
	DataDir string `json:"dataDir,omitempty"`
}

// DefaultDataDir returns the OS user-config data dir (<UserConfigDir>/uniterm).
func DefaultDataDir() (string, error) {
	// If DataDirRoot is set (c-shared mode), use it directly instead of
	// os.UserConfigDir() which may fail if XDG_CONFIG_HOME is not visible to Go.
	if DataDirRoot != "" {
		return filepath.Join(DataDirRoot, "uniterm"), nil
	}
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg, "uniterm"), nil
}

func exeDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func bootstrapPath() (string, error) {
	dir, err := exeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "data", bootstrapFileName), nil
}

// userConfigDir returns the user config dir (<UserConfigDir>/uniTerm) that
// holds the bootstrap pointer for non-portable setups. Unlike the exe/data
// location it is writable for installs under a read-only Program Files /
// Applications.
func userConfigDir() (string, error) {
	return DefaultDataDir()
}

// bootstrapTargetPaths decides where a bootstrap of the given kind is written
// and which stale location to remove afterwards.
//
//	portable → lives with the exe (exe/data) so it follows a USB stick.
//	everything else → lives in the user config dir (writable even from a
//	read-only install dir).
//
// To keep only one valid pointer on disk (a mode switch must not silently
// shadow one another at read time) the stale location is the other one.
func bootstrapTargetPaths(kind, exe, userCfgDir string) (primary, stale string) {
	exePath := filepath.Join(exe, "data", bootstrapFileName)
	userPath := filepath.Join(userCfgDir, bootstrapFileName)
	if kind == "portable" {
		return exePath, userPath
	}
	return userPath, exePath
}

// bootstrapSearchOrder returns the candidate paths read at startup, newest
// preference first: the user-config bootstrap (authoritative for installs),
// then the exe/data one (portable fallback). Each is validated as it is read.
func bootstrapSearchOrder(exe, userCfgDir string) []string {
	exePath := filepath.Join(exe, "data", bootstrapFileName)
	userPath := filepath.Join(userCfgDir, bootstrapFileName)
	legacy := filepath.Join(userPath, bootstrapFileName)
	if exePath == userPath {
		return []string{exePath}
	}
	return []string{exePath, userPath, legacy}
}

// ResolveDataDir determines where config files live.
//   - Valid bootstrap.json in (user-config, then exe/data) → resolve its path.
//   - No valid bootstrap + default dir has config files → Upgrade (existing user).
//   - Otherwise → FirstRun.
func ResolveDataDir() (DataDir, error) {
	exe, err := exeDir()
	if err != nil {
		return DataDir{}, err
	}
	defDir, err := userConfigDir()
	if err != nil {
		return DataDir{}, err
	}
	return resolveDataDirAt(exe, defDir)
}

// resolveDataDirAt is ResolveDataDir with injectable locations (tests).
// defDir is the OS default data dir, which also hosts the user-config
// bootstrap pointer.
func resolveDataDirAt(exe, defDir string) (DataDir, error) {
	for _, bp := range bootstrapSearchOrder(exe, defDir) {
		b, err := readBootstrap(bp)
		if err != nil || b == nil {
			continue
		}
		dir, err := resolvePath(b, exe, defDir)
		if err != nil || dir == "" || !pathExists(dir) {
			continue // invalid or missing path -> try next location
		}
		migrateLegacyBootstrap(defDir, bp, b)
		return DataDir{Path: dir, Type: b.Type}, nil
	}
	if hasConfigFiles(defDir) {
		log.Writef("no valid bootstrap; default dir has config -> upgrade dataDir=%s", defDir)
		return DataDir{Path: defDir, Type: "default", Upgrade: true}, nil
	}
	log.Writef("no valid bootstrap and no config in default dir -> first run")
	// Auto-init: in server mode (e.g. HarmonyOS c-shared), skip the first-run
	// dialog and automatically use the default data directory.
	if AutoInitMode || os.Getenv("AI_OPS_AUTO_INIT") != "" {
		if err := os.MkdirAll(defDir, 0755); err != nil {
			log.Writef("auto-init: MkdirAll failed: %v", err)
			return DataDir{FirstRun: true}, nil
		}
		if err := WriteBootstrap("default", ""); err != nil {
			log.Writef("auto-init: WriteBootstrap failed: %v", err)
		}
		log.Writef("auto-init: using default data dir: %s", defDir)
		return DataDir{Path: defDir, Type: "default"}, nil
	}
	return DataDir{FirstRun: true}, nil
}

// migrateLegacyBootstrap rewrites a pointer found at the old double-joined
// path (<UserConfigDir>/uniTerm/bootstrap.json/bootstrap.json) to the correct
// location. Best-effort: on failure the pointer stays where it is and the
// legacy path remains in the search order, so resolution keeps working.
func migrateLegacyBootstrap(defDir, found string, b *bootstrap) {
	userPath := filepath.Join(defDir, bootstrapFileName)
	legacyPath := filepath.Join(userPath, bootstrapFileName)
	if found != legacyPath {
		return
	}
	clearLegacyNestedLayout(defDir)
	if err := writeJSONFile(userPath, *b); err != nil {
		log.Writef("bootstrap migrate: write %s: %v", userPath, err)
		return
	}
	log.Writef("bootstrap migrated %s -> %s", legacyPath, userPath)
}

// clearLegacyNestedLayout removes the directory a pre-fix build left at
// <UserConfigDir>/uniTerm/bootstrap.json (the double-joined pointer path).
// Renaming a fresh pointer file over that directory would fail, so it must
// go before any write.
func clearLegacyNestedLayout(defDir string) {
	userPath := filepath.Join(defDir, bootstrapFileName)
	if fi, err := os.Stat(userPath); err == nil && fi.IsDir() {
		if err := os.RemoveAll(userPath); err != nil {
			log.Writef("bootstrap: remove legacy nested pointer %s: %v", userPath, err)
		} else {
			log.Writef("bootstrap: removed legacy nested pointer dir %s", userPath)
		}
	}
}

func readBootstrap(path string) (*bootstrap, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var b bootstrap
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, err
	}
	return &b, nil
}

func resolvePath(b *bootstrap, exe, defDir string) (string, error) {
	switch b.Type {
	case "default":
		return defDir, nil
	case "portable":
		return filepath.Join(exe, "data"), nil
	case "custom":
		if b.DataDir == "" {
			return "", nil
		}
		return b.DataDir, nil
	default:
		return "", nil
	}
}

// WriteBootstrap writes the bootstrap pointer for the given kind to the
// canonical location (user config dir for default/custom, exe/data for
// portable) and removes the stale location so only one pointer exists.
func WriteBootstrap(kind, customDir string) error {
	exe, err := exeDir()
	if err != nil {
		return err
	}
	defDir, err := userConfigDir()
	if err != nil {
		return err
	}
	return writeBootstrapAt(exe, defDir, kind, customDir)
}

func writeBootstrapAt(exe, defDir, kind, customDir string) error {
	// A pre-fix build may have left bootstrap.json as a directory (the
	// double-joined pointer path); renaming over that would fail.
	clearLegacyNestedLayout(defDir)
	primary, stale := bootstrapTargetPaths(kind, exe, defDir)

	b := bootstrap{Type: kind}
	if kind == "custom" {
		b.DataDir = customDir
	}
	if err := os.MkdirAll(filepath.Dir(primary), 0755); err != nil {
		return err
	}
	if err := writeJSONFile(primary, b); err != nil {
		return err
	}
	// A mode switch must not leave a second, shadowing pointer behind. A
	// failed removal is logged, not swallowed: a surviving stale pointer
	// shadows whichever location lost the race.
	if stale != primary {
		if err := os.Remove(stale); err != nil && !os.IsNotExist(err) {
			log.Writef("bootstrap: remove stale pointer %s: %v", stale, err)
		}
	}
	return nil
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func hasConfigFiles(dir string) bool {
	for _, name := range []string{"connections.json", "settings.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return true
		}
	}
	return false
}
