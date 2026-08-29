package session

// ProbeConnection tests whether a connection config can actually connect /
// authenticate, WITHOUT opening a persistent session. It powers the frontend's
// "Test connection" button (issue #377): the App.TestConnection Wails method
// first materializes identity/proxy references (which requires the store), then
// dispatches session-owned protocols to this function.
//
// Return values: on success a short human-readable description; on failure a
// readable error that must NOT echo the password (Protocol errors are wrapped
// as-is so drivers do the talking, but we never interpolate config.Password).

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
	"github.com/redis/go-redis/v9"
	"github.com/rhnvrm/simples3"
	"github.com/studio-b12/gowebdav"
	"golang.org/x/crypto/ssh"

	"github.com/cloudsoda/go-smb2"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/ys-ll/uniterm/backend/database"
)

// ProbeConnection dispatches a connectivity probe by config.Type.
// Types owned by the App dispatcher (k8s / container) are not handled here.
func ProbeConnection(config ConnectionConfig) (string, error) {
	switch config.Type {
	case "ssh":
		return probeSSH(config)
	case "telnet":
		return probeTelnet(config)
	case "tcp":
		return probeTCP(config)
	case "ftp":
		return probeFTP(config)
	case "s3":
		return probeS3(config)
	case "webdav":
		return probeWebDAV(config)
	case "smb":
		return probeSMB(config)
	case "redis":
		return probeRedis(config)
	case "mongodb":
		return probeMongo(config)
	case "database":
		return probeDatabase(config)
	default:
		return "", fmt.Errorf("connection type %q does not support connection testing", config.Type)
	}
}

func probeSSH(config ConnectionConfig) (string, error) {
	// Non-interactive: keyboard-interactive challenges are rejected so a test
	// can never block waiting for typed input in a modal dialog.
	kb := func(user, instruction string, questions []string, echos []bool) ([]string, error) {
		return nil, fmt.Errorf("interactive auth not allowed during connection test")
	}
	authMethods := makeSSHAuthMethods(config, kb)
	addr := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	clientConfig := &ssh.ClientConfig{
		User:            config.User,
		Auth:            authMethods,
		Timeout:         15 * time.Second,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	// Honor a materialized proxy (set by App.materializeProxy) on the first hop,
	// mirroring the terminal session's dial path.
	client, err := dialSSHWithCipherFallback(addr, clientConfig, func() (net.Conn, error) {
		return dialFirstHop(addr, config.Proxy)
	})
	if err != nil {
		return "", fmt.Errorf("ssh: %w", err)
	}
	defer client.Close()
	return fmt.Sprintf("ssh: connected as %s@%s:%d", config.User, config.Host, config.Port), nil
}

func probeTelnet(config ConnectionConfig) (string, error) {
	addr := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return "", fmt.Errorf("telnet: %w", err)
	}
	conn.Close()
	return fmt.Sprintf("telnet: %s:%d reachable", config.Host, config.Port), nil
}

// probeTCP checks that a plain TCP socket to host:port can be established.
func probeTCP(config ConnectionConfig) (string, error) {
	addr := net.JoinHostPort(config.Host, strconv.Itoa(config.Port))
	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return "", fmt.Errorf("tcp: %w", err)
	}
	conn.Close()
	return fmt.Sprintf("tcp: %s:%d reachable", config.Host, config.Port), nil
}

func probeFTP(config ConnectionConfig) (string, error) {
	addr := fmt.Sprintf("%s:%d", config.Host, config.Port)
	if config.Port <= 0 {
		addr = fmt.Sprintf("%s:21", config.Host)
	}
	encryption := config.FtpEncryption
	if encryption == "" {
		encryption = "none"
	}
	tlsConfig := &tls.Config{InsecureSkipVerify: config.FtpSkipVerify}

	var conn *ftp.ServerConn
	var err error
	switch encryption {
	case "required":
		conn, err = ftp.Dial(addr, ftp.DialWithTimeout(30*time.Second), ftp.DialWithExplicitTLS(tlsConfig))
	case "auto":
		conn, err = ftp.Dial(addr, ftp.DialWithTimeout(30*time.Second), ftp.DialWithExplicitTLS(tlsConfig))
		if err != nil {
			conn, err = ftp.Dial(addr, ftp.DialWithTimeout(30*time.Second))
		}
	default:
		conn, err = ftp.Dial(addr, ftp.DialWithTimeout(30*time.Second))
	}
	if err != nil {
		return "", fmt.Errorf("ftp: %w", err)
	}
	defer conn.Quit()
	if err := conn.Login(config.User, config.Password); err != nil {
		return "", fmt.Errorf("ftp login: %w", err)
	}
	return fmt.Sprintf("ftp: logged in as %s@%s", config.User, config.Host), nil
}

func probeS3(config ConnectionConfig) (string, error) {
	c := simples3.New(config.S3Region, config.User, config.Password)
	c.Endpoint = strings.TrimSuffix(config.Host, "/")
	if config.S3URLStyle != "path" {
		c.SetVirtualHostedStyle(true)
	}
	// ListBuckets is the lightest probe that validates endpoint reachability AND
	// access-key validity.
	if _, err := c.ListBuckets(simples3.ListBucketsInput{}); err != nil {
		return "", fmt.Errorf("s3: %w", err)
	}
	return fmt.Sprintf("s3: credentials valid for %s", config.Host), nil
}

func probeWebDAV(config ConnectionConfig) (string, error) {
	url := strings.TrimSuffix(config.Host, "/")
	client := gowebdav.NewClient(url, config.User, config.Password)
	if err := client.Connect(); err != nil {
		return "", fmt.Errorf("webdav: %w", err)
	}
	return fmt.Sprintf("webdav: connected to %s", url), nil
}

func probeSMB(config ConnectionConfig) (string, error) {
	port := config.Port
	if port <= 0 {
		port = 445
	}
	addr := net.JoinHostPort(config.Host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, 15*time.Second)
	if err != nil {
		return "", fmt.Errorf("smb dial: %w", err)
	}
	d := &smb2.Dialer{
		Initiator: &smb2.NTLMInitiator{
			User:     config.User,
			Password: config.Password,
			Domain:   config.SmbDomain,
		},
	}
	sess, err := d.DialConn(context.Background(), conn, addr)
	if err != nil {
		conn.Close()
		return "", fmt.Errorf("smb handshake: %w", err)
	}
	defer func() {
		_ = sess.Logoff()
		conn.Close()
	}()
	return fmt.Sprintf("smb: authenticated as %s@%s", config.User, config.Host), nil
}

func probeRedis(config ConnectionConfig) (string, error) {
	var client *redis.Client
	if config.RedisMode == "sentinel" {
		var addrs []string
		for _, a := range strings.Split(config.RedisSentinels, ",") {
			if a = strings.TrimSpace(a); a != "" {
				addrs = append(addrs, a)
			}
		}
		if len(addrs) == 0 {
			return "", fmt.Errorf("redis sentinel: no sentinel addresses")
		}
		if config.RedisMasterName == "" {
			return "", fmt.Errorf("redis sentinel: master name required")
		}
		client = redis.NewFailoverClient(&redis.FailoverOptions{
			MasterName:       config.RedisMasterName,
			SentinelAddrs:    addrs,
			SentinelUsername: config.SentinelUser,
			SentinelPassword: config.SentinelPassword,
			Username:         config.User,
			Password:         config.Password,
			DB:               0,
		})
	} else {
		client = redis.NewClient(&redis.Options{
			Addr:     fmt.Sprintf("%s:%d", config.Host, config.Port),
			Username: config.User,
			Password: config.Password,
			DB:       0,
		})
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := client.Ping(ctx).Result(); err != nil {
		return "", fmt.Errorf("redis ping: %w", err)
	}
	return "redis: pong", nil
}

func probeMongo(config ConnectionConfig) (string, error) {
	uri := buildMongoURI(config)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return "", fmt.Errorf("mongodb connect: %w", err)
	}
	defer client.Disconnect(context.Background())
	if err := client.Ping(ctx, nil); err != nil {
		return "", fmt.Errorf("mongodb ping: %w", err)
	}
	return fmt.Sprintf("mongodb: connected to %s:%d", config.Host, config.Port), nil
}

func probeDatabase(config ConnectionConfig) (string, error) {
	dsn, err := database.BuildDSN(config.DBType, config.Host, config.User, config.Password, config.DBName, config.DBParams, config.Port)
	if err != nil {
		return "", err
	}
	db, err := database.NewDB(config.DBType, dsn)
	if err != nil {
		return "", err
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return "", fmt.Errorf("ping %s: %w", config.DBType, err)
	}
	return fmt.Sprintf("%s: connected to %s:%d", config.DBType, config.Host, config.Port), nil
}
