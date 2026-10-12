package k8s

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/laigcss/ai-ops-terminal/backend/log"
)

// maxK8sResponseBytes caps the size of any single REST response body so
// a runaway server (or a misconfigured apiserver returning huge CRDs
// or log lists) cannot exhaust process memory. 64 MiB matches the
// typical kubectl response cap and is well above any realistic single
// object (K8S-05).
const maxK8sResponseBytes = 64 * 1024 * 1024

// defaultK8sRequestTimeout is a safety net for non-watch callers that
// pass a ctx without a deadline; the http.Client we wrap has Timeout=0
// (intentional, for watches), so a slow apiserver would otherwise hang
// the caller's goroutine indefinitely (F-411).
const defaultK8sRequestTimeout = 5 * time.Minute

// debugK8sREST is set by the UNITERM_DEBUG_K8S_REST env var. When true,
// Do() emits a 300-byte body preview for every successful response —
// useful for local debugging, but expensive on a 1 Hz polling loop
// (F-406). Off by default.
var debugK8sREST = os.Getenv("UNITERM_DEBUG_K8S_REST") == "1"

// Do 是通用 REST 请求 —— 拼 URL、发请求、返回 (status, body, err)。
// path 必须以 "/" 开头。contentType 可以为空。
//
// If ctx has no deadline, a default 5-minute deadline is applied so a
// hung apiserver cannot pin the caller's goroutine forever (F-411).
func Do(ctx context.Context, client *http.Client, base, method, path string, body []byte, contentType string) (int, []byte, error) {
	if !strings.HasPrefix(path, "/") {
		return 0, nil, fmt.Errorf("path must start with /: %q", path)
	}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultK8sRequestTimeout)
		defer cancel()
	}
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		log.Writef("[k8s] %s %s%s -> transport err: %v", method, base, path, err)
		return 0, nil, err
	}
	defer resp.Body.Close()
	// Cap the read so a pathological server can't OOM us (K8S-05).
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxK8sResponseBytes+1))
	if err != nil {
		log.Writef("[k8s] %s %s%s -> read body err: %v (status=%d)", method, base, path, err, resp.StatusCode)
		return resp.StatusCode, nil, err
	}
	if len(b) > maxK8sResponseBytes {
		return resp.StatusCode, nil, errors.New("response body exceeds 64 MiB limit")
	}
	// F-406: body preview is gated behind UNITERM_DEBUG_K8S_REST=1 so a
	// 1 Hz polling loop doesn't pay fmt.Sprintf + os.File.Write on every
	// successful response. Production logs only status, method, path,
	// byte count, latency.
	if debugK8sREST {
		// S4: never log the response body of Secret / ConfigMap
		// resources — even a 300-byte preview can leak credentials or
		// sensitive config. Emit a fixed placeholder instead.
		if isSensitiveResourcePath(path) {
			log.Writef("[k8s] %s %s%s -> %d bytes=%d body=*** redacted ***", method, base, path, resp.StatusCode, len(b))
		} else {
			preview := b
			if len(preview) > 300 {
				preview = preview[:300]
			}
			log.Writef("[k8s] %s %s%s -> %d bytes=%d body=%s", method, base, path, resp.StatusCode, len(b), string(preview))
		}
	} else {
		log.Writef("[k8s] %s %s%s -> %d bytes=%d dur=%s", method, base, path, resp.StatusCode, len(b), time.Since(start))
	}
	return resp.StatusCode, b, nil
}

// isSensitiveResourcePath reports whether the REST path targets a Kubernetes
// resource kind whose body may carry secrets/config (S4). Used to suppress
// the debug body preview so credentials never land in the log file.
// Matches e.g. `/api/v1/namespaces/default/secrets/my-token` or
// `/api/v1/namespaces/default/configmaps/app-config`.
func isSensitiveResourcePath(path string) bool {
	return strings.Contains(path, "/secrets/") || strings.Contains(path, "/configmaps/")
}
