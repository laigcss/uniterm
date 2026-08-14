package store

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/ys-ll/uniterm/backend/session"
)

// TestConnectionStore_LoadFillsPasswordSynchronously verifies the F-110
// regression fix: Load() must return connections with their keychain
// passwords already populated. Previously the password was filled by an
// async goroutine AFTER Load returned, so the frontend received a snapshot
// with empty passwords and prompted the user for a password that already
// existed in the keychain.
func TestConnectionStore_LoadFillsPasswordSynchronously(t *testing.T) {
	dir := t.TempDir()
	s := &ConnectionStore{configDir: dir}

	// Seed connections.json with a password-auth connection (password
	// field empty — the keychain holds it, matching the migrated format).
	seed := session.ConnectionStoreData{
		Groups: []session.ConnectionGroup{},
		Connections: []session.ConnectionConfig{
			{ID: "c1", Name: "prod", Type: "ssh", AuthType: "password", Host: "8.41.56.121", User: "cnapsafe", Password: ""},
			{ID: "c2", Name: "keyless", Type: "ssh", AuthType: "key", Host: "h2", User: "u2"},
		},
	}
	if err := s.writeJSONLocked(seed); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Wire a keychain that has a password for c1 only.
	ps := fakePasswordStore{store: map[string]string{"c1": "cnapsafe-pw"}}
	s.SetPasswordStore(ps)

	data, err := s.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(data.Connections) != 2 {
		t.Fatalf("expected 2 connections, got %d", len(data.Connections))
	}

	// c1: password must be present synchronously.
	var c1, c2 session.ConnectionConfig
	for _, c := range data.Connections {
		switch c.ID {
		case "c1":
			c1 = c
		case "c2":
			c2 = c
		}
	}
	if c1.Password != "cnapsafe-pw" {
		t.Fatalf("c1 password not filled by Load: got %q, want %q (async-fill regression)", c1.Password, "cnapsafe-pw")
	}
	// c2: key auth — password untouched.
	if c2.Password != "" {
		t.Fatalf("c2 should have empty password, got %q", c2.Password)
	}
}

// TestConnectionStore_LoadMissingPasswordStaysEmpty verifies that a
// password-auth connection with NO keychain entry loads cleanly with an
// empty password (the session will then prompt interactively) instead of
// erroring out.
func TestConnectionStore_LoadMissingPasswordStaysEmpty(t *testing.T) {
	dir := t.TempDir()
	s := &ConnectionStore{configDir: dir}

	seed := session.ConnectionStoreData{
		Groups:      []session.ConnectionGroup{},
		Connections: []session.ConnectionConfig{{ID: "c1", Type: "ssh", AuthType: "password", Password: ""}},
	}
	if err := s.writeJSONLocked(seed); err != nil {
		t.Fatalf("seed: %v", err)
	}
	s.SetPasswordStore(fakePasswordStore{store: map[string]string{}})

	data, err := s.Load()
	if err != nil {
		t.Fatalf("Load with no keychain entry should not error: %v", err)
	}
	if len(data.Connections) != 1 {
		t.Fatalf("expected 1 connection, got %d", len(data.Connections))
	}
	if data.Connections[0].Password != "" {
		t.Fatalf("expected empty password, got %q", data.Connections[0].Password)
	}
}

// TestConnectionStore_LoadUsesCache verifies the pwdCache optimization:
// the keychain is consulted only once per connection; subsequent Loads
// serve from cache.
func TestConnectionStore_LoadUsesCache(t *testing.T) {
	dir := t.TempDir()
	s := &ConnectionStore{configDir: dir}

	seed := session.ConnectionStoreData{
		Groups:      []session.ConnectionGroup{},
		Connections: []session.ConnectionConfig{{ID: "c1", Type: "ssh", AuthType: "password", Password: ""}},
	}
	if err := s.writeJSONLocked(seed); err != nil {
		t.Fatalf("seed: %v", err)
	}

	var gets atomic.Int32
	ps := countingPasswordStore{fakePasswordStore{store: map[string]string{"c1": "pw"}}, &gets}
	s.SetPasswordStore(ps)

	if _, err := s.Load(); err != nil {
		t.Fatalf("first Load: %v", err)
	}
	if _, err := s.Load(); err != nil {
		t.Fatalf("second Load: %v", err)
	}
	if got := gets.Load(); got != 1 {
		t.Fatalf("keychain GetPassword called %d times, want 1 (cache miss on repeat loads)", got)
	}
}

// countingPasswordStore wraps fakePasswordStore and counts GetPassword calls.
type countingPasswordStore struct {
	fakePasswordStore
	gets *atomic.Int32
}

func (c countingPasswordStore) GetPassword(connID string) (string, error) {
	c.gets.Add(1)
	return c.fakePasswordStore.GetPassword(connID)
}

var _ = os.Stat // keep os import if unused on some platforms
var _ = filepath.Join
