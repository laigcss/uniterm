package store

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const bootstrapFileName = "bootstrap.json"

type bootstrap struct {
	Type    string `json:"type"`
	DataDir string `json:"dataDir,omitempty"`
}

// DataDir is the result of resolving the config data directory at startup.
type DataDir struct {
	Path     string
	Type     string
	FirstRun bool
	Upgrade  bool
}

// DefaultDataDir returns the OS user-config data dir (<UserConfigDir>/uniTerm).
func DefaultDataDir() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg, "uniTerm"), nil
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

// ResolveDataDir determines where config files live.
//   - Valid bootstrap.json → resolve its path.
//   - No bootstrap + default dir has config files → Upgrade (existing user).
//   - Otherwise → FirstRun.
func ResolveDataDir() (DataDir, error) {
	bp, err := bootstrapPath()
	if err != nil {
		return DataDir{}, err
	}
	if b, err := readBootstrap(bp); err == nil && b != nil {
		if dir, err := resolvePath(b); err == nil && dir != "" && pathExists(dir) {
			return DataDir{Path: dir, Type: b.Type}, nil
		}
		// Invalid or missing path → fall through.
	}
	def, err := DefaultDataDir()
	if err != nil {
		return DataDir{}, err
	}
	if hasConfigFiles(def) {
		return DataDir{Path: def, Type: "default", Upgrade: true}, nil
	}
	return DataDir{FirstRun: true}, nil
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

func resolvePath(b *bootstrap) (string, error) {
	switch b.Type {
	case "default":
		return DefaultDataDir()
	case "portable":
		dir, err := exeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(dir, "data"), nil
	case "custom":
		if b.DataDir == "" {
			return "", nil
		}
		return b.DataDir, nil
	default:
		return "", nil
	}
}

// WriteBootstrap writes <exe_dir>/data/bootstrap.json with the given kind.
func WriteBootstrap(kind, customDir string) error {
	dir, err := exeDir()
	if err != nil {
		return err
	}
	dataDir := filepath.Join(dir, "data")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}
	b := bootstrap{Type: kind}
	if kind == "custom" {
		b.DataDir = customDir
	}
	data, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return atomicWriteFile(filepath.Join(dataDir, bootstrapFileName), data, 0600)
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
