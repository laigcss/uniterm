package importer

import (
	"fmt"
	"os"
	"path/filepath"
)

// Parse reads the source file and dispatches to the matching provider. Providers
// return groups/connections with freshly generated ids and restored group paths.
// OpenSSH uses the default ~/.ssh/config when no path is given.
func Parse(format, srcPath string, opts ParseOptions) (*ImportResult, error) {
	if format == FormatOpenSSH && srcPath == "" {
		srcPath = defaultSSHConfigPath()
	}
	data, err := os.ReadFile(srcPath)
	if err != nil {
		return nil, err
	}
	switch format {
	case FormatUniterm:
		return parseUniterm(data, opts)
	case FormatXshell:
		return parseXshell(data)
	case FormatMobaXterm:
		return parseMobaXterm(data)
	case FormatWindTerm:
		return parseWindTerm(data, srcPath, opts)
	case FormatSecureCRT:
		return parseSecureCRT(data)
	case FormatOpenSSH:
		return parseOpenSSH(data)
	default:
		return nil, fmt.Errorf("unknown import format %q", format)
	}
}

// defaultSSHConfigPath returns the platform default OpenSSH config location.
func defaultSSHConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ".ssh/config"
	}
	return filepath.Join(home, ".ssh", "config")
}
