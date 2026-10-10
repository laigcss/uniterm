package log

import "testing"

func TestRedact(t *testing.T) {
	// Save and restore the global toggle so this test is hermetic.
	prev := RedactEnabled
	defer func() { RedactEnabled = prev }()
	RedactEnabled = true

	cases := []struct {
		name string
		in   string
		want string
	}{
		// --- password= / pwd= / passwd= ---
		{
			name: "password equals",
			in:   "connecting with password=hunter2 ok",
			want: "connecting with password=*** ok",
		},
		{
			name: "pwd equals",
			in:   "pwd=hunter2",
			want: "pwd=***",
		},
		{
			name: "passwd equals",
			in:   "passwd=hunter2",
			want: "passwd=***",
		},
		{
			name: "password quoted",
			in:   "password=\"hunter2\"",
			want: "password=***",
		},
		{
			name: "password case insensitive key",
			in:   "PASSWORD=hunter2",
			want: "PASSWORD=***",
		},
		{
			name: "password at end of string",
			in:   "cfg password=hunter2",
			want: "cfg password=***",
		},

		// --- DSN user:pass@host ---
		{
			name: "postgres dsn",
			in:   "postgres://alice:s3cr3t@db.example.com:5432/app?sslmode=disable",
			want: "postgres://alice:***@db.example.com:5432/app?sslmode=disable",
		},
		{
			name: "mysql dsn",
			in:   "alice:s3cr3t@tcp(10.0.0.1:3306)/app?charset=utf8mb4",
			want: "alice:***@tcp(10.0.0.1:3306)/app?charset=utf8mb4",
		},
		{
			name: "url with embedded creds",
			in:   "https://user:pass@example.com/path",
			want: "https://user:***@example.com/path",
		},

		// --- Bearer / token ---
		{
			name: "bearer token",
			in:   "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc",
			want: "Authorization: Bearer ***",
		},
		{
			name: "bearer lowercase",
			in:   "bearer abc123",
			want: "bearer ***",
		},
		{
			name: "token equals",
			in:   "token=abc123",
			want: "token=***",
		},
		{
			name: "access_token equals",
			in:   "access_token=abc123",
			want: "access_token=***",
		},

		// --- PEM private key ---
		{
			name: "rsa private key",
			in:   "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
			want: "-----BEGIN RSA PRIVATE KEY-----\n***\n-----END RSA PRIVATE KEY-----",
		},
		{
			name: "ec private key",
			in:   "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...\n-----END EC PRIVATE KEY-----",
			want: "-----BEGIN EC PRIVATE KEY-----\n***\n-----END EC PRIVATE KEY-----",
		},
		{
			name: "openssh private key",
			in:   "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNza...\n-----END OPENSSH PRIVATE KEY-----",
			want: "-----BEGIN OPENSSH PRIVATE KEY-----\n***\n-----END OPENSSH PRIVATE KEY-----",
		},

		// --- mixed / non-secret ---
		{
			name: "no secrets",
			in:   "connecting to host:5432 as alice",
			want: "connecting to host:5432 as alice",
		},
		{
			name: "empty string",
			in:   "",
			want: "",
		},
		{
			name: "multiple secrets in one line",
			in:   "password=hunter2 token=abc123 Bearer xyz",
			want: "password=*** token=*** Bearer ***",
		},
		{
			name: "dsn and password combined",
			in:   "postgres://alice:s3cr3t@host:5432/db password=hunter2",
			want: "postgres://alice:***@host:5432/db password=***",
		},

		// --- JSON sensitive fields ---
		{
			name: "json password field",
			in:   `{"password":"hunter2","user":"alice"}`,
			want: `{"password":"***","user":"alice"}`,
		},
		{
			name: "json token field",
			in:   `{"token":"abc123"}`,
			want: `{"token":"***"}`,
		},
		{
			name: "json access_token field",
			in:   `{"access_token":"eyJhbGciOiJIUzI1NiJ9"}`,
			want: `{"access_token":"***"}`,
		},
		{
			name: "json secret field",
			in:   `{"secret":"my-secret-value"}`,
			want: `{"secret":"***"}`,
		},
		{
			name: "json api_key field",
			in:   `{"api_key":"sk-1234567890"}`,
			want: `{"api_key":"***"}`,
		},
		{
			name: "json apikey field (no underscore)",
			in:   `{"apikey":"sk-1234567890"}`,
			want: `{"apikey":"***"}`,
		},
		{
			name: "json private_key field",
			in:   `{"private_key":"-----BEGIN..."}`,
			want: `{"private_key":"***"}`,
		},
		{
			name: "json multiple sensitive fields",
			in:   `{"password":"hunter2","token":"abc123","name":"alice"}`,
			want: `{"password":"***","token":"***","name":"alice"}`,
		},
		{
			name: "json case insensitive keys",
			in:   `{"PASSWORD":"hunter2","Token":"abc123"}`,
			want: `{"PASSWORD":"***","Token":"***"}`,
		},
		{
			name: "json with spaces around colon",
			in:   `{"password" : "hunter2"}`,
			want: `{"password" : "***"}`,
		},
		{
			name: "json non-sensitive field unchanged",
			in:   `{"name":"alice","age":30}`,
			want: `{"name":"alice","age":30}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Redact(tc.in)
			if got != tc.want {
				t.Errorf("Redact(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestRedactDisabled(t *testing.T) {
	prev := RedactEnabled
	defer func() { RedactEnabled = prev }()
	RedactEnabled = false

	in := "password=hunter2 Bearer abc123 postgres://u:p@h/db"
	if got := Redact(in); got != in {
		t.Errorf("Redact with disabled flag should be no-op; got %q", got)
	}
}
