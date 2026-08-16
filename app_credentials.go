package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/ys-ll/uniterm/backend/credentials"
	"github.com/ys-ll/uniterm/backend/store"
	"github.com/ys-ll/uniterm/backend/sync"
)

type DataDirInfo struct {
	DataDir  string `json:"dataDir"`
	Type     string `json:"type"`
	FirstRun bool   `json:"firstRun"`
}

type CredentialStatus struct {
	Mode            string `json:"mode"`
	Unlocked        bool   `json:"unlocked"`
	NeedsSetup      bool   `json:"needsSetup"`
	KeychainLost    bool   `json:"keychainLost"`
	ExistingSecrets int    `json:"existingSecrets"`
}

// GetDataDirInfo returns the current data directory info for the settings tab.
func (a *App) GetDataDirInfo() (DataDirInfo, error) {
	if a.dataDir == "" {
		return DataDirInfo{DataDir: "", Type: "default", FirstRun: true}, nil
	}
	return DataDirInfo{DataDir: a.dataDir, Type: a.dataDirType(), FirstRun: false}, nil
}

// SetDataDir selects the data directory (first-run) or changes it (migrate
// flag). Returns an error if the target is not writable or, for a non-migrate
// change into an existing dir, the new dir's credentials cannot be unlocked.
func (a *App) SetDataDir(kind, customDir string, migrate bool) error {
	target, err := dataDirFor(kind, customDir)
	if err != nil {
		return err
	}
	if !isWritable(target) {
		return fmt.Errorf("directory not writable: %s", target)
	}
	if err := os.MkdirAll(target, 0755); err != nil {
		return err
	}

	// On first run: init stores at the target and return.
	if a.dataDir == "" {
		a.dataDir = target
		_ = store.WriteBootstrap(kind, customDir)
		a.initStores(target, false)
		runtime.EventsEmit(a.ctx, "app:dataDirReady", target)
		return nil
	}

	// Change directory (runtime).
	if migrate {
		if err := copyDir(a.dataDir, target); err != nil {
			return err
		}
		// Ruling 15: keychain entries are scoped by data-dir hash. The copied
		// files are still encrypted under the current key, but the target dir
		// has no keychain-key/<targetHash> entry, so AutoUnlock would report
		// KeychainLost after restart. Re-scope the current key to the target
		// hash (no re-encryption needed — files stay under the same key).
		// Master-password mode needs nothing: its salt is copied and the user
		// re-enters the password.
		if cs := a.credentialStore; cs != nil {
			st := cs.Status()
			if st.Mode == credentials.ModeKeychain && st.Unlocked {
				if err := credentials.New(target, sync.NewKeychain()).Rekey(credentials.ModeKeychain, nil, cs.Key()); err != nil {
					return err
				}
			}
		}
	} else if !dirUnlockable(target) {
		return errors.New("cannot unlock credentials in the target directory")
	}
	_ = store.WriteBootstrap(kind, customDir)
	// Remove the source only after bootstrap points at the target; any earlier
	// failure leaves the old dir intact so the user can retry without loss.
	if migrate {
		if err := removeDataDir(a.dataDir); err != nil {
			return err
		}
	}
	return errors.New("restart required") // frontend prompts restart
}

func (a *App) GetCredentialStatus() (CredentialStatus, error) {
	if a.credentialStore == nil {
		return CredentialStatus{NeedsSetup: true}, nil
	}
	st := a.credentialStore.Status()
	return CredentialStatus{
		Mode:         st.Mode,
		Unlocked:     st.Unlocked,
		NeedsSetup:   st.NeedsSetup,
		KeychainLost: st.KeychainLost,
	}, nil
}

func (a *App) SetupCredentials(mode, masterPassword string) error {
	if a.credentialStore == nil {
		return errors.New("credential store not initialized")
	}
	return a.credentialStore.Setup(mode, masterPassword)
}

func (a *App) UnlockCredentials(masterPassword string) error {
	if a.credentialStore == nil {
		return errors.New("credential store not initialized")
	}
	return a.credentialStore.Unlock(masterPassword)
}

func (a *App) SwitchCredentialMode(targetMode, masterPassword string) error {
	cs := a.credentialStore
	if cs == nil || !cs.Status().Unlocked {
		return errors.New("credentials locked")
	}
	oldKey := cs.Key()

	var newKey, newSalt []byte
	switch targetMode {
	case credentials.ModeKeychain:
		// Switching away from master-password removes a protection layer, so
		// require the current master password once — the same verification
		// ChangeMasterPassword does before re-keying.
		if meta, _ := credentials.ReadMeta(a.dataDir); meta != nil && meta.Mode == credentials.ModeMasterPassword {
			if string(sync.DeriveKey(masterPassword, meta.Salt)) != string(oldKey) {
				return errors.New("master password incorrect")
			}
		}
		var err error
		newKey, err = randomKey32()
		if err != nil {
			return err
		}
	case credentials.ModeMasterPassword:
		if masterPassword == "" {
			return errors.New("master password required")
		}
		var err error
		newSalt, err = sync.GenerateSalt()
		if err != nil {
			return err
		}
		newKey = sync.DeriveKey(masterPassword, newSalt)
	default:
		return fmt.Errorf("unknown mode %q", targetMode)
	}

	if err := a.reencryptAll(cs, oldKey, newKey); err != nil {
		return err
	}
	if err := cs.Rekey(targetMode, newSalt, newKey); err != nil {
		// Roll files back under oldKey; otherwise a failed Rekey leaves them
		// encrypted under a key that is never persisted.
		_ = a.reencryptAll(cs, newKey, oldKey)
		return err
	}
	if targetMode == credentials.ModeKeychain {
		_ = cs.ClearKeychainCache()
	}
	return nil
}

func (a *App) ChangeMasterPassword(oldPassword, newPassword string) error {
	cs := a.credentialStore
	if cs == nil {
		return errors.New("credential store not initialized")
	}
	meta, _ := credentials.ReadMeta(a.dataDir)
	if meta == nil || meta.Mode != credentials.ModeMasterPassword {
		return errors.New("not in master-password mode")
	}
	// Verify the old password derives the current key.
	if string(sync.DeriveKey(oldPassword, meta.Salt)) != string(cs.Key()) {
		return errors.New("old password incorrect")
	}
	oldKey := cs.Key()
	newSalt, err := sync.GenerateSalt()
	if err != nil {
		return err
	}
	newKey := sync.DeriveKey(newPassword, newSalt)
	if err := a.reencryptAll(cs, oldKey, newKey); err != nil {
		return err
	}
	if err := cs.Rekey(credentials.ModeMasterPassword, newSalt, newKey); err != nil {
		_ = a.reencryptAll(cs, newKey, oldKey)
		return err
	}
	return nil
}

func (a *App) ResetCredentials() error {
	cs := a.credentialStore
	if cs == nil {
		return errors.New("credential store not initialized")
	}
	// Clear all encrypted fields, delete meta + keychain cache.
	a.clearEncryptedFields()
	_ = cs.ClearKeychainCache()
	_ = os.Remove(credentials.MetaPath(a.dataDir))
	// Force re-setup on next launch.
	cs.SetKey(nil)
	return nil
}

// reencryptAll decrypts all secret fields under oldKey and re-encrypts them
// under newKey by loading (decrypt) then saving (encrypt) both stores.
func (a *App) reencryptAll(cs *credentials.Store, oldKey, newKey []byte) error {
	if a.connectionStore == nil || a.settingsStore == nil {
		return errors.New("stores not initialized")
	}
	conns, err := a.connectionStore.Load()
	if err != nil {
		return err
	}
	settings, err := a.settingsStore.Load()
	if err != nil {
		return err
	}
	// Swap key, re-encrypt on save.
	cs.SetKey(newKey)
	if err := a.connectionStore.Save(conns); err != nil {
		cs.SetKey(oldKey)
		return err
	}
	if err := a.settingsStore.Save(settings); err != nil {
		// Roll the connection store back under oldKey so both files stay
		// encrypted under a single consistent key.
		cs.SetKey(oldKey)
		_ = a.connectionStore.Save(conns)
		return err
	}
	return nil
}

// clearEncryptedFields rewrites connections.json and settings.json with empty
// secret fields WITHOUT decrypting. It must work while the credential store is
// locked (keychain-lost / reset), when Load()/Save() would fail because they
// require the master key to decrypt the very fields we are clearing.
func (a *App) clearEncryptedFields() {
	clearSecretsInFile(filepath.Join(a.dataDir, "connections.json"), "connections")
	clearSecretsInFile(filepath.Join(a.dataDir, "settings.json"), "settings")
}

// clearSecretsInFile blanks the secret fields (connections[].password or
// ai.models[].apiKey) in a raw JSON config file, preserving every other field.
// Missing/corrupt files are left untouched.
func clearSecretsInFile(path, kind string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(data, &obj); err != nil {
		return
	}
	switch kind {
	case "connections":
		if conns, ok := obj["connections"].([]interface{}); ok {
			for _, c := range conns {
				if cm, ok := c.(map[string]interface{}); ok {
					cm["password"] = ""
				}
			}
		}
	case "settings":
		if ai, ok := obj["ai"].(map[string]interface{}); ok {
			if models, ok := ai["models"].([]interface{}); ok {
				for _, m := range models {
					if mm, ok := m.(map[string]interface{}); ok {
						mm["apiKey"] = ""
					}
				}
			}
		}
	}
	out, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, out, 0600)
}

func (a *App) dataDirType() string {
	if dd, err := store.ResolveDataDir(); err == nil {
		return dd.Type
	}
	return "custom"
}

func dataDirFor(kind, customDir string) (string, error) {
	switch kind {
	case "default":
		return store.DefaultDataDir()
	case "portable":
		exe, err := os.Executable()
		if err != nil {
			return "", err
		}
		return filepath.Join(filepath.Dir(exe), "data"), nil
	case "custom":
		if customDir == "" {
			return "", errors.New("custom dir required")
		}
		return customDir, nil
	default:
		return "", fmt.Errorf("unknown data dir kind %q", kind)
	}
}

func isWritable(dir string) bool {
	probe := filepath.Join(dir, ".probe")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return false
	}
	if err := os.WriteFile(probe, []byte("x"), 0600); err != nil {
		return false
	}
	_ = os.Remove(probe)
	return true
}

func randomKey32() ([]byte, error) {
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	return k, nil
}

// removeDataDir deletes the files copied out of src during a migration so the
// move leaves no duplicate user data behind. It skips the same skipMigrate
// artifacts (sync repo, sync-config.json, bootstrap.json, .git) that copyDir
// left in place — those are not user config and must stay put.
func removeDataDir(src string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if path == src {
			return nil // keep the source directory itself
		}
		rel, _ := filepath.Rel(src, path)
		if skipMigrate(rel) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if err := os.RemoveAll(path); err != nil {
			return err
		}
		if info.IsDir() {
			return filepath.SkipDir
		}
		return nil
	})
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		if skipMigrate(rel) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}

// skipMigrate reports whether a path (relative to the data-dir root) should be
// excluded from a migration copy. Sync artifacts — the sync working repo, a
// legacy bare repo, and sync-config.json — live in the system default dir and
// are not user data; bootstrap.json is a startup pointer that always sits at
// <exe>/data. Any .git directory is skipped defensively: git object files are
// read-only, so copying them is slow and error-prone.
func skipMigrate(rel string) bool {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for _, p := range parts {
		if p == ".git" {
			return true
		}
	}
	switch parts[0] {
	case "sync-repo", "sync-repo.git", "sync-config.json", "bootstrap.json":
		return true
	}
	return false
}

func dirUnlockable(target string) bool {
	meta, err := credentials.ReadMeta(target)
	if err != nil || meta == nil {
		return true // no meta → new/empty dir is fine
	}
	probe := credentials.New(target, sync.NewKeychain())
	if err := probe.AutoUnlock(); err != nil {
		return false
	}
	return probe.Status().Unlocked
}
