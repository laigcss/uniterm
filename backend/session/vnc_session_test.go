package session

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestVNCConfigRoundTrip exercises the JSON round-trip of the three VNC
// fields added for issue #95 (VncEncryption / VncShared / VncRepeaterID).
// The frontend sets these on ConnectionConfig, the backend round-trips
// them through Wails binding, and the frontend noVNC RFB constructor
// reads them — so the JSON tags must survive a marshal / unmarshal cycle
// without losing values or picking up spurious zero values from the
// omitempty path.
func TestVNCConfigRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		in   ConnectionConfig
		want ConnectionConfig
	}{
		{
			name: "all three fields set",
			in: ConnectionConfig{
				VncEncryption: "require",
				VncShared:     false,
				VncRepeaterID: "mymachine",
			},
			want: ConnectionConfig{
				VncEncryption: "require",
				VncShared:     false,
				VncRepeaterID: "mymachine",
			},
		},
		{
			name: "all three fields zero / empty",
			in:   ConnectionConfig{},
			want: ConnectionConfig{},
		},
		{
			name: "auto + shared = default policy (issue #95)",
			in: ConnectionConfig{
				VncEncryption: "auto",
				VncShared:     true,
			},
			want: ConnectionConfig{
				VncEncryption: "auto",
				VncShared:     true,
			},
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.in)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			// omitempty must strip the all-zero case so existing saved
			// configs (which pre-date these fields) keep the same
			// on-disk shape they always had.
			if tt.in.VncEncryption == "" && tt.in.VncRepeaterID == "" && !tt.in.VncShared {
				for _, k := range []string{"vncEncryption", "vncShared", "vncRepeaterID"} {
					if strings.Contains(string(data), k) {
						t.Errorf("empty zero value should be omitted, but %q found in %s", k, data)
					}
				}
			}
			var out ConnectionConfig
			if err := json.Unmarshal(data, &out); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if out.VncEncryption != tt.want.VncEncryption ||
				out.VncShared != tt.want.VncShared ||
				out.VncRepeaterID != tt.want.VncRepeaterID {
				t.Errorf("round-trip mismatch:\n got %+v\nwant %+v", out, tt.want)
			}
		})
	}
}

// TestVNCSessionConnectPortResolution covers the port handling in
// VNCSession.Connect. VNC servers normally listen on 5900+display, so
// the frontend sometimes sends display-number form (1, 23) instead of
// the absolute port — Connect translates these to 5901 / 5923. An
// explicit absolute port (e.g. a repeater on 5500) must be left alone.
// The dial target itself is internal to Connect, so we just verify
// Connect does not panic and the session reaches a terminal status.
func TestVNCSessionConnectPortResolution(t *testing.T) {
	ports := []int{0, 1, 23, 5900, 5500}
	for _, port := range ports {
		s := NewVNCSession("vnc-port")
		cfg := ConnectionConfig{
			Type: "vnc",
			Host: "127.0.0.1",
			Port: port,
		}
		_ = s.Connect(cfg)
		_ = s.Disconnect()
		if st := s.Status(); st == StatusConnecting {
			t.Errorf("Connect left status=connecting for port=%d, want a terminal status", port)
		}
	}
}
