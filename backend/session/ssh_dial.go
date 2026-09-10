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

// DialSSHOptions 聚合 SSH 拨号所需的全部参数。零值字段按默认安全策略处理。
//
// 各 session 的 Connect 与 test_connection 共享 dialSSH，避免 ClientConfig
// 构造、主机密钥回调和算法列表在 6+ 处重复。差异点（超时、cipher 回退、
// 自定义 dial）通过本结构以显式参数传入。
type DialSSHOptions struct {
	Host string // 远端主机名或 IP
	Port int    // 远端端口
	User string // 登录用户名

	// AuthMethods 是已构造好的 ssh.AuthMethod 列表。调用方负责选择
	// buildAuthMethods（非交互）或 makeSSHAuthMethods（含键盘交互回调）。
	AuthMethods []ssh.AuthMethod

	// HostKeyStrategy 控制主机密钥校验："" / "tofu" / "accept-new" 走 TOFU，
	// "strict" 严格校验，"off"/"insecure" 关闭校验。空串回退到全局默认策略。
	HostKeyStrategy string

	// Timeout 是 SSH 握手超时。零值=30s。
	Timeout time.Duration

	// Proxy 是第一跳上游 SOCKS5/HTTP 代理；nil 表示直连。仅当 Dial 为 nil 时生效。
	Proxy *SocksProxy

	// CipherFallback 启用 CTR-first cipher 回退：当首选 AEAD 握手返回 io.EOF
	// 时，重试一次 CTR 优先列表。用于旧服务器错误广播 GCM 但实际不支持的场合。
	// 交互式 SSH 会话与连接测试启用；SFTP/SCP/monitor/tunnel 不启用。
	CipherFallback bool

	// Dial 覆盖默认底层 TCP dial（含代理）。当非 nil 时，Proxy 被忽略。
	// tunnel_forward.go 的链式拨号用此参数在上一跳的 ssh.Client 上 Dial。
	Dial func() (net.Conn, error)
}

// dialSSH 统一封装 SSH ClientConfig 构造、主机密钥校验、cipher 回退与代理拨号。
//
// 行为契约：
//   - 构造 ClientConfig{User, Auth, Timeout, HostKeyCallback, Config: sshAlgorithms()}
//   - 主机密钥回调走 HostKeyCallback → ResolveHostKeyStrategy，保留 S1 的 TOFU 逻辑
//   - Dial 非 nil 时用它；否则用 dialFirstHop(addr, Proxy)
//   - CipherFallback=true 走 dialSSHWithCipherFallback（含 TCP keepalive 与 CTR 重试）
//   - CipherFallback=false 走单次握手（与原 dialSSHTCP 行为一致）
func dialSSH(opts DialSSHOptions) (*ssh.Client, error) {
	if opts.Timeout == 0 {
		opts.Timeout = 30 * time.Second
	}
	addr := net.JoinHostPort(opts.Host, strconv.Itoa(opts.Port))
	clientConfig := &ssh.ClientConfig{
		User:            opts.User,
		Auth:            opts.AuthMethods,
		Timeout:         opts.Timeout,
		HostKeyCallback: HostKeyCallback(opts.Host, strconv.Itoa(opts.Port), ResolveHostKeyStrategy(opts.HostKeyStrategy)),
		Config:          sshAlgorithms(),
	}

	dial := opts.Dial
	if dial == nil {
		proxy := opts.Proxy
		dial = func() (net.Conn, error) { return dialFirstHop(addr, proxy) }
	}

	if opts.CipherFallback {
		return dialSSHWithCipherFallback(addr, clientConfig, dial)
	}

	raw, err := dial()
	if err != nil {
		return nil, fmt.Errorf("tcp dial: %w", err)
	}
	sshConn, chans, reqs, err := ssh.NewClientConn(raw, addr, clientConfig)
	if err != nil {
		raw.Close()
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	return ssh.NewClient(sshConn, chans, reqs), nil
}

// DialSSHClient 建立非交互 SSH 连接（容器 runner 用，无 PTY、无键盘交互回显）。
// 与 ssh_session 的交互式拨号共享认证与密钥交换配置。
func DialSSHClient(config ConnectionConfig) (*ssh.Client, error) {
	kb := func(user, instruction string, questions []string, echos []bool) ([]string, error) {
		return nil, fmt.Errorf("keyboard-interactive not supported in this context")
	}
	return dialSSH(DialSSHOptions{
		Host:            config.Host,
		Port:            config.Port,
		User:            config.User,
		AuthMethods:     makeSSHAuthMethods(config, kb),
		HostKeyStrategy: config.HostKeyStrategy,
		Timeout:         30 * time.Second,
		Proxy:           config.Proxy,
		CipherFallback:  true,
	})
}
