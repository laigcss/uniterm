package session

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/ssh"
)

// newEncryptedKeyFile writes an ed25519 private key protected by passphrase to
// a new temp file and returns its path. Mirrors the "秘钥加密码" scenario from
// issue #647: an SSH private key that requires a passphrase to decrypt.
func newEncryptedKeyFile(t *testing.T, passphrase string) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(priv, "uniterm-test", []byte(passphrase))
	if err != nil {
		t.Fatalf("marshal encrypted key: %v", err)
	}
	path := filepath.Join(t.TempDir(), "id_ed25519")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0600); err != nil {
		t.Fatalf("write key: %v", err)
	}
	return path
}

// TestBuildAuthMethods locks in the behavior that SFTP and monitor sessions rely
// on for "key + passphrase" authentication. Before the fix both built their auth
// methods inline and decoded the key with ssh.ParsePrivateKey (no passphrase), so
// an encrypted key could never authenticate — exactly the issue #647 report.
func TestBuildAuthMethods(t *testing.T) {
	keyPath := newEncryptedKeyFile(t, "secret-pass")

	cases := []struct {
		name    string
		config  ConnectionConfig
		wantErr bool
	}{
		{"encrypted key + correct passphrase", ConnectionConfig{AuthType: "key", KeyPath: keyPath, Password: "secret-pass"}, false},
		{"encrypted key + no passphrase", ConnectionConfig{AuthType: "key", KeyPath: keyPath}, true},
		{"encrypted key + wrong passphrase", ConnectionConfig{AuthType: "key", KeyPath: keyPath, Password: "wrong"}, true},
		{"plain password", ConnectionConfig{AuthType: "password", Password: "pw"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			methods, err := buildAuthMethods(tc.config)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("buildAuthMethods() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("buildAuthMethods() error = %v", err)
			}
			if len(methods) == 0 {
				t.Fatalf("buildAuthMethods() returned 0 methods, want > 0")
			}
		})
	}
}