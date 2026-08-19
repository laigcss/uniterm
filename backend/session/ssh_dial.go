package session

import (
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"

	"golang.org/x/crypto/ssh"
)

type sshConnDialer func() (net.Conn, error)

// dialSSHWithCipherFallback keeps modern AEAD preference, but retries a
// handshake EOF once with CTR first for servers that falsely advertise GCM.
func dialSSHWithCipherFallback(addr string, config *ssh.ClientConfig, dial sshConnDialer) (*ssh.Client, error) {
	algorithms := []ssh.Config{sshAlgorithms(), sshAlgorithmsCTRFirst()}
	var lastErr error
	for i, algorithms := range algorithms {
		conn, err := dial()
		if err != nil {
			return nil, fmt.Errorf("tcp dial: %w", err)
		}
		if tcpConn, ok := conn.(*net.TCPConn); ok {
			tcpConn.SetKeepAlive(true)
			tcpConn.SetKeepAlivePeriod(sshKeepAliveInterval)
		}
		attempt := *config
		attempt.Config = algorithms
		sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, &attempt)
		if err == nil {
			return ssh.NewClient(sshConn, chans, reqs), nil
		}
		conn.Close()
		lastErr = err
		if i == 0 && errors.Is(err, io.EOF) {
			continue
		}
		break
	}
	return nil, fmt.Errorf("ssh handshake: %w", lastErr)
}

// dialSSHTCP dials addr (through the upstream proxy when non-nil), performs the
// SSH handshake, and returns a *ssh.Client. Used by the SFTP and monitor
// sessions, which previously dialed directly via ssh.Dial.
func dialSSHTCP(addr string, clientConfig *ssh.ClientConfig, upstream *SocksProxy) (*ssh.Client, error) {
	raw, err := dialFirstHop(addr, upstream)
	if err != nil {
		return nil, fmt.Errorf("tcp dial: %w", err)
	}
	conn, chans, reqs, err := ssh.NewClientConn(raw, addr, clientConfig)
	if err != nil {
		raw.Close()
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	return ssh.NewClient(conn, chans, reqs), nil
}

// DialSSHClient 建立非交互 SSH 连接（容器 runner 用，无 PTY、无键盘交互回显）。
// 与 ssh_session 的交互式拨号共享认证与密钥交换配置。
func DialSSHClient(config ConnectionConfig) (*ssh.Client, error) {
	kb := func(user, instruction string, questions []string, echos []bool) ([]string, error) {
		return nil, fmt.Errorf("keyboard-interactive not supported in this context")
	}
	authMethods := makeSSHAuthMethods(config, kb)
	addr := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	clientConfig := &ssh.ClientConfig{
		User:            config.User,
		Auth:            authMethods,
		Timeout:         30 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	return dialSSHWithCipherFallback(addr, clientConfig, func() (net.Conn, error) {
		return net.DialTimeout("tcp", addr, clientConfig.Timeout)
	})
}
