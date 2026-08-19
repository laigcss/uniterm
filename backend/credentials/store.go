package credentials

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	stdsync "sync"

	unitsync "github.com/ys-ll/uniterm/backend/sync"
)

// Keychain is the subset of sync.Keychain this package needs.
type Keychain interface {
	Get(key string) (string, error)
	Set(key, value string) error
	Delete(key string) error
}

// Status describes the credential store state for the frontend.
type Status struct {
	Mode         string
	Unlocked     bool
	NeedsSetup   bool
	KeychainLost bool
}

// Store owns the master key used to encrypt/decrypt secret fields. The key
// source is orthogonal to the data directory: keychain mode keeps a random key
// in the OS keychain; master-password mode derives the key from a password and
// caches the derived key in the keychain for auto-unlock.
type Store struct {
	dataDir  string
	keychain Keychain
	mu       stdsync.Mutex
	mode     string
	salt     []byte
	key      []byte
}

func New(dataDir string, kc Keychain) *Store {
	return &Store{dataDir: dataDir, keychain: kc}
}

func (s *Store) DataDir() string { return s.dataDir }

// DirHash returns the hex sha256 of the absolute data dir path, used to scope
// keychain entries per directory.
func (s *Store) DirHash() string {
	abs, _ := filepath.Abs(s.dataDir)
	sum := sha256.Sum256([]byte(abs))
	return hex.EncodeToString(sum[:])
}

func (s *Store) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{Mode: s.mode, Unlocked: s.key != nil}
	if s.mode == "" {
		st.NeedsSetup = true
	} else if s.mode == ModeKeychain && s.key == nil {
		st.KeychainLost = true
	}
	return st
}

// AutoUnlock loads credentials.meta and attempts to recover the master key.
func (s *Store) AutoUnlock() error {
	meta, err := ReadMeta(s.dataDir)
	if err != nil {
		return err
	}
	if meta == nil {
		return nil // NeedsSetup
	}
	h := s.DirHash()
	var key []byte
	switch meta.Mode {
	case ModeKeychain:
		k, ok := s.getKey("keychain-key/" + h)
		if !ok {
			s.set(meta.Mode, meta.Salt, nil)
			return nil // KeychainLost
		}
		key = k
	case ModeMasterPassword:
		if k, ok := s.getKey("master-key/" + h); ok {
			key = k
		}
	default:
		return fmt.Errorf("unknown credential mode %q", meta.Mode)
	}
	s.set(meta.Mode, meta.Salt, key)
	return nil
}

// Setup establishes a NEW mode. Used on first run and after reset.
func (s *Store) Setup(mode, masterPassword string) error {
	var key, salt []byte
	switch mode {
	case ModeKeychain:
		var err error
		key, err = randomKey()
		if err != nil {
			return err
		}
	case ModeMasterPassword:
		if masterPassword == "" {
			return errors.New("master password required")
		}
		var err error
		salt, err = unitsync.GenerateSalt()
		if err != nil {
			return err
		}
		key = unitsync.DeriveKey(masterPassword, salt)
	default:
		return fmt.Errorf("unknown credential mode %q", mode)
	}
	return s.Rekey(mode, salt, key)
}

// Unlock derives the master key from a master password (master-password mode only).
func (s *Store) Unlock(masterPassword string) error {
	s.mu.Lock()
	mode, salt := s.mode, s.salt
	s.mu.Unlock()
	if mode != ModeMasterPassword {
		return errors.New("not in master-password mode")
	}
	key := unitsync.DeriveKey(masterPassword, salt)
	// Cache the derived key for future auto-unlock.
	if err := s.keychain.Set("master-key/"+s.DirHash(), hex.EncodeToString(key)); err != nil {
		return err
	}
	s.set(mode, salt, key)
	return nil
}

func (s *Store) Encrypt(plaintext string) (string, error) {
	key := s.currentKey()
	if key == nil {
		return "", errors.New("credentials locked")
	}
	return EncryptField(plaintext, key)
}

func (s *Store) Decrypt(encoded string) (string, error) {
	key := s.currentKey()
	if key == nil {
		return "", errors.New("credentials locked")
	}
	return DecryptField(encoded, key)
}

func (s *Store) Key() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.key
}

// Unlocked reports whether the store holds a usable key. It is false while
// master-password mode is not yet unlocked, keychain mode has lost its key, or
// the store has never been set up.
func (s *Store) Unlocked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.key != nil
}

func (s *Store) SetKey(key []byte) {
	s.mu.Lock()
	s.key = key
	s.mu.Unlock()
}

// Rekey persists the new mode/salt/key (keychain entry + credentials.meta) and
// swaps them into memory. Used by Setup and switch-mode orchestration.
func (s *Store) Rekey(mode string, salt, key []byte) error {
	entry := "keychain-key/" + s.DirHash()
	if mode == ModeMasterPassword {
		entry = "master-key/" + s.DirHash()
	}
	if err := s.keychain.Set(entry, hex.EncodeToString(key)); err != nil {
		return err
	}
	if err := WriteMeta(s.dataDir, &Meta{Mode: mode, Salt: salt}); err != nil {
		return err
	}
	s.set(mode, salt, key)
	return nil
}

// ClearKeychainCache removes the master-password derived-key cache. Used when
// switching master-password → keychain and on reset.
func (s *Store) ClearKeychainCache() error {
	return s.keychain.Delete("master-key/" + s.DirHash())
}

func (s *Store) currentKey() []byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.key
}

func (s *Store) set(mode string, salt, key []byte) {
	s.mu.Lock()
	s.mode, s.salt, s.key = mode, salt, key
	s.mu.Unlock()
}

func (s *Store) getKey(name string) ([]byte, bool) {
	v, err := s.keychain.Get(name)
	if err != nil || v == "" {
		return nil, false
	}
	b, err := hex.DecodeString(v)
	if err != nil {
		return nil, false
	}
	return b, true
}

func randomKey() ([]byte, error) {
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, fmt.Errorf("generate master key: %w", err)
	}
	return k, nil
}
