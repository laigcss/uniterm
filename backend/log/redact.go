package log

import "regexp"

// RedactEnabled toggles sensitive-value redaction in log output. Default
// true; set to false only for tests that need to assert on raw secrets.
var RedactEnabled = true

// redactors are applied in order; each targets a specific secret shape.
// Order matters: the PEM block redactor runs first so its multi-line
// content isn't partially mangled by the simpler single-line patterns.
var redactors = []struct {
	re  *regexp.Regexp
	sub string
}{
	// 1. PEM private keys: keep the BEGIN/END markers (which encode the
	//    key type, e.g. RSA / EC / OPENSSH / ENCRYPTED) but replace the
	//    base64 body with "***". `[\s\S]*?` is the non-greedy dot-all
	//    equivalent (RE2 has no (?s) flag).
	{
		re:  regexp.MustCompile(`-----BEGIN (\w+) PRIVATE KEY-----[\s\S]*?-----END \w+ PRIVATE KEY-----`),
		sub: "-----BEGIN $1 PRIVATE KEY-----\n***\n-----END $1 PRIVATE KEY-----",
	},
	// 2. DSN password segment: `user:password@host` (postgres, mysql,
	//    sqlserver DSNs all use this shape). The password class excludes
	//    "/" so a `scheme://user:pass@` URL isn't mis-parsed as
	//    `scheme: //<user>:<pass>@` (the "//" would otherwise be a valid
	//    non-@ non-space run). Non-greedy via the excluded char classes.
	{
		re:  regexp.MustCompile(`([A-Za-z0-9._~+-]+):([^@\s/]+)@`),
		sub: "$1:***@",
	},
	// 3. `password=...`, `pwd=...`, `passwd=...` (connection strings,
	//    query params, log fmt). Value runs to the next whitespace or
	//    end-of-string; an optional surrounding quote is preserved.
	{
		re:  regexp.MustCompile(`(?i)(password|passwd|pwd)=("?[^\s"]+"?)`),
		sub: "$1=***",
	},
	// 4. Bearer tokens in Authorization headers / log lines. Capture the
	//    "Bearer" spelling so the original case is preserved on replace.
	{
		re:  regexp.MustCompile(`(?i)(Bearer) [A-Za-z0-9._~+/=-]+`),
		sub: "$1 ***",
	},
	// 5. `token=...`, `access_token=...`.
	{
		re:  regexp.MustCompile(`(?i)(access_token|token)=("?[^\s"]+"?)`),
		sub: "$1=***",
	},
}

// Redact returns s with sensitive substrings replaced by "***". It is a
// no-op when RedactEnabled is false. The function is safe for concurrent
// use: regexp.ReplaceAllString documents that a Regexp is safe for
// concurrent use by multiple goroutines.
func Redact(s string) string {
	if !RedactEnabled || s == "" {
		return s
	}
	for _, r := range redactors {
		s = r.re.ReplaceAllString(s, r.sub)
	}
	return s
}
