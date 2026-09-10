package session

import "os"

// FileTransferSession is the common interface for all file-transfer sessions
// (SFTP, SCP, FTP, SMB, WebDAV, S3, WSL). Every direct Sftp* app method in
// app_file_transfer.go dispatches through this contract, so protocol-agnostic
// features (like the external editor) work across every file-transfer backend
// without per-protocol code.
//
// The interface is defined here in backend/session (not in the main package) so
// that each implementation can carry a compile-time assertion
//
//	var _ FileTransferSession = (*SFTPSession)(nil)
//
// and the compiler guarantees the contract holds at every build, instead of
// relying on comments and runtime type-assertions in the App layer.
//
// Method semantics:
//   - Remote paths are absolute or relative to the session's remote cwd.
//   - Local paths are absolute or relative to the session's local cwd.
//   - Transfers return a task ID (string) for progress/cancel tracking.
//   - Unsupported operations return ErrNotSupported (e.g. FTP Chmod).
type FileTransferSession interface {
	// --- Remote listing & navigation ---
	ListRemote(dir string) (FileListResult, error)
	ChangeRemoteDir(dir string) (FileListResult, error)

	// --- Local listing & navigation (shared via localFSOps) ---
	ListLocal(dir string) (FileListResult, error)
	ChangeLocalDir(dir string) (FileListResult, error)
	ListLocalDrives() ([]FileItem, error)

	// --- Remote filesystem operations ---
	MakeDir(dir string) error
	Remove(path string, recursive bool) error
	Rename(oldPath, newPath string) error
	Chmod(path string, mode os.FileMode) error
	Copy(oldPath, newPath string) error
	Move(oldPath, newPath string) error

	// --- Local filesystem operations (shared via localFSOps) ---
	LocalRemove(path string, recursive bool) error
	LocalRename(oldPath, newPath string) error
	LocalMkdir(dir string) error
	LocalGetContent(path string) ([]byte, error)
	LocalPutContent(path string, content []byte) error
	LocalCopy(oldPath, newPath string) error
	LocalMove(oldPath, newPath string) error

	// --- Transfers ---
	Get(remotePath, localPath string, recursive bool) (string, error)
	Put(localPath, remotePath string, recursive bool) (string, error)
	PutContent(remotePath string, content []byte) error
	GetContent(remotePath string) ([]byte, error)
	CancelTransfer(taskID string) error
	PauseTransfer(taskID string) error
	ResumeTransfer(taskID string) error
}

// ErrNotSupported is returned by FileTransferSession methods that a protocol
// cannot implement (e.g. FTP has no Chmod, S3 has no symlink). The App layer
// surfaces it as a user-facing "operation not supported by <protocol>" message
// instead of a generic error.
var ErrNotSupported = errNotSupported{}

type errNotSupported struct{}

func (errNotSupported) Error() string { return "operation not supported by this protocol" }

// Compile-time assertions that each file-transfer session implements the full
// FileTransferSession contract. A missing method surfaces as a build error at
// the assertion site, pointing directly at the session that needs the stub.
//
// WSLFileSession is asserted in wsl_file_session.go (Windows-only) because its
// non-Windows stub in wsl_file_session_stub.go intentionally does not implement
// the file-transfer methods.
var (
	_ FileTransferSession = (*SFTPSession)(nil)
	_ FileTransferSession = (*SCPSession)(nil)
	_ FileTransferSession = (*FTPSession)(nil)
	_ FileTransferSession = (*SMBSession)(nil)
	_ FileTransferSession = (*WebDAVSession)(nil)
	_ FileTransferSession = (*S3Session)(nil)
)
