//go:build server

package sync

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// File-based keychain store for server mode (e.g. HarmonyOS c-shared),
// where no OS keyring is available. Implements the same keychainGet/Set/
// Delete/List functions as platform_*.go but stores data in a JSON file.

var (
	keychainMu       sync.Mutex
	keychainFilePath string
	keychainData     map[string]string
	keychainLoaded   bool
)

// SetKeychainDir sets the directory where the file-based keychain stores its data.
func SetKeychainDir(dir string) {
	keychainFilePath = filepath.Join(dir, ".keychain.json")
}

func keychainLoad() error {
	keychainMu.Lock()
	defer keychainMu.Unlock()
	if keychainLoaded {
		return nil
	}
	keychainData = make(map[string]string)
	if keychainFilePath == "" {
		keychainLoaded = true
		return nil
	}
	b, err := os.ReadFile(keychainFilePath)
	if err != nil {
		if os.IsNotExist(err) {
			keychainLoaded = true
			return nil
		}
		return err
	}
	if err := json.Unmarshal(b, &keychainData); err != nil {
		keychainData = make(map[string]string)
	}
	keychainLoaded = true
	return nil
}

func keychainSave() error {
	if keychainFilePath == "" {
		return nil
	}
	b, err := json.MarshalIndent(keychainData, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(keychainFilePath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	return os.WriteFile(keychainFilePath, b, 0600)
}

func keychainGet(service, key string) (string, error) {
	if err := keychainLoad(); err != nil {
		return "", err
	}
	keychainMu.Lock()
	defer keychainMu.Unlock()
	val, ok := keychainData[key]
	if !ok {
		return "", errors.New("key not found")
	}
	return val, nil
}

func keychainSet(service, key, value string) error {
	if err := keychainLoad(); err != nil {
		return err
	}
	keychainMu.Lock()
	defer keychainMu.Unlock()
	keychainData[key] = value
	return keychainSave()
}

func keychainDelete(service, key string) error {
	if err := keychainLoad(); err != nil {
		return err
	}
	keychainMu.Lock()
	defer keychainMu.Unlock()
	delete(keychainData, key)
	return keychainSave()
}

func keychainList(service string) ([]string, error) {
	if err := keychainLoad(); err != nil {
		return nil, err
	}
	keychainMu.Lock()
	defer keychainMu.Unlock()
	keys := make([]string, 0, len(keychainData))
	for k := range keychainData {
		keys = append(keys, k)
	}
	return keys, nil
}
