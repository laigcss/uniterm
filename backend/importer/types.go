package importer

import "github.com/ys-ll/uniterm/backend/session"

// Format names match the frontend import-type dropdown values verbatim.
const (
	FormatUniterm   = "uniterm"
	FormatXshell    = "xshell"
	FormatMobaXterm = "mobaxterm"
	FormatWindTerm  = "windterm"
	FormatSecureCRT = "securecrt"
	FormatOpenSSH   = "openssh"
)

// ParseOptions carries per-parse inputs. Password is the import password for the
// uniterm own-format (encrypted=true) path, or the WindTerm master password for
// the windterm path; empty means "no password".
type ParseOptions struct {
	Password string
}

// ImportResult is the normalized output of every provider. IDs are already
// regenerated; Warnings records non-fatal issues (e.g. "password not imported").
type ImportResult struct {
	Groups      []session.ConnectionGroup  `json:"groups"`
	Connections []session.ConnectionConfig `json:"connections"`
	Warnings    []string                   `json:"warnings"`
}
