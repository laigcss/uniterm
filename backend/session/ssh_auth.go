package session

import (
	"fmt"
	"os"

	"golang.org/x/crypto/ssh"
)

func makeSSHAuthMethods(config ConnectionConfig, kbCallback ssh.KeyboardInteractiveChallenge) []ssh.AuthMethod {
	var methods []ssh.AuthMethod

	switch config.AuthType {
	case "password":
		methods = append(methods, ssh.Password(config.Password))
	case "key":
		if signer, ok := parsePrivateKeyFile(config.KeyPath, config.Password); ok {
			methods = append(methods, ssh.PublicKeys(signer))
		}
	}

	// Keyboard-interactive as fallback for password-less or failed-password scenarios.
	if kbCallback != nil {
		methods = append(methods, ssh.KeyboardInteractive(kbCallback))
	}

	return methods
}

// buildAuthMethods returns the auth methods used by non-interactive SIP sessions
// (SFTP, server monitor) that dial via dialSSHTCP. It shares parsePrivateKeyFile
// with the interactive SSH session so an encrypted private key + its passphrase
// (config.Password) authenticates identically everywhere — the "秘钥加密码" case
// from issue #647. Unlike makeSSHAuthMethods it has no keyboard-interactive
// fallback (unattended), uses the passphrase as the authentication signal for
// key files, and treats "agent" as password for backward compatibility.
func buildAuthMethods(config ConnectionConfig) ([]ssh.AuthMethod, error) {
	switch config.AuthType {
	case "key":
		signer, ok := parsePrivateKeyFile(config.KeyPath, config.Password)
		if !ok {
			return nil, fmt.Errorf("parse key: %s 不存在、无权限或口令错误", config.KeyPath)
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	default: // "", "password", "agent" and any unknown type fall back to password
		return []ssh.AuthMethod{ssh.Password(config.Password)}, nil
	}
}

// parsePrivateKeyFile reads the private key at path and parses it, using
// passphrase when the key is encrypted. Returns (nil, false) on any error;
// the caller is expected to fall back to other auth methods so the SSH
// handshake surfaces a meaningful error to the user.
func parsePrivateKeyFile(path, passphrase string) (ssh.Signer, bool) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	if passphrase != "" {
		signer, err := ssh.ParsePrivateKeyWithPassphrase(key, []byte(passphrase))
		if err != nil {
			return nil, false
		}
		return signer, true
	}
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, false
	}
	return signer, true
}
