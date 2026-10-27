package session

import (
	"net/url"
	"testing"
)

func TestSPICESessionUsesBackendProxy(t *testing.T) {
	s := NewSPICESession("spice")
	if err := s.Connect(ConnectionConfig{Host: "guest.invalid", Port: 2}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Disconnect() })
	addr, err := url.Parse(s.ProxyAddr())
	if err != nil {
		t.Fatal(err)
	}
	if addr.Hostname() != "127.0.0.1" || !s.IsConnected() {
		t.Fatalf("SPICE session exposed a remote endpoint: %q", s.ProxyAddr())
	}
	if s.proxy.target != "guest.invalid:5902" {
		t.Fatalf("display port was not normalized before proxying: %q", s.proxy.target)
	}
}
