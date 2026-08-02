package session

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

// mkXauthEntry encodes one xauthority entry in the wire format:
//   uint16 family | uint16 addr_len | addr | uint16 num_len | num |
//   uint16 name_len | name | uint16 data_len | data
func mkXauthEntry(t *testing.T, family uint16, addr, num, name, data string) []byte {
	t.Helper()
	var buf bytes.Buffer
	write := func(v any) { binary.Write(&buf, binary.BigEndian, v) }
	writeField := func(s string) {
		write(uint16(len(s)))
		buf.WriteString(s)
	}
	write(family)
	writeField(addr)
	writeField(num)
	writeField(name)
	writeField(data)
	return buf.Bytes()
}

func writeXauthFile(t *testing.T, path string, entries ...[]byte) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, e := range entries {
		f.Write(e)
	}
}

func TestLookupCookie_MITMagic_Local(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Xauthority")
	cookie := []byte("0123456789abcdef")
	writeXauthFile(t, path,
		mkXauthEntry(t, 0, "", "0", "MIT-MAGIC-COOKIE-1", string(cookie)),
	)

	proto, got, err := LookupCookie(path, ":0")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if proto != "MIT-MAGIC-COOKIE-1" {
		t.Errorf("proto = %q, want MIT-MAGIC-COOKIE-1", proto)
	}
	if !bytes.Equal(got, cookie) {
		t.Errorf("cookie = %x, want %x", got, cookie)
	}
}

func TestLookupCookie_WildcardFamily(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Xauthority")
	cookie := []byte("wildcard-cookie!!!!")
	writeXauthFile(t, path,
		mkXauthEntry(t, 65535, "", "0", "MIT-MAGIC-COOKIE-1", string(cookie)),
	)

	_, got, err := LookupCookie(path, "localhost:0.0")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if !bytes.Equal(got, cookie) {
		t.Errorf("cookie = %x, want %x", got, cookie)
	}
}

func TestLookupCookie_NotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Xauthority")
	writeXauthFile(t, path,
		mkXauthEntry(t, 0, "", "0", "XDM-AUTHORIZATION-1", "deadbeef"),
	)

	_, _, err := LookupCookie(path, ":0")
	if err == nil {
		t.Fatal("expected error for unsupported protocol")
	}
}

func TestLookupCookie_FileMissing(t *testing.T) {
	_, _, err := LookupCookie("/no/such/file", ":0")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLookupCookie_DisplayNumberMismatch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Xauthority")
	writeXauthFile(t, path,
		mkXauthEntry(t, 0, "", "0", "MIT-MAGIC-COOKIE-1", "right-display"),
		mkXauthEntry(t, 0, "", "5", "MIT-MAGIC-COOKIE-1", "wrong-display"),
	)
	_, got, err := LookupCookie(path, ":5")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if string(got) != "wrong-display" {
		t.Errorf("cookie = %q, want %q (matched display :5 entry)", got, "wrong-display")
	}
}
