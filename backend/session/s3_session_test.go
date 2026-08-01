package session

import (
	"testing"
)

// TestS3SessionConnectURLStyle verifies that the S3URLStyle flag from
// ConnectionConfig is correctly forwarded to the underlying simples3 client.
// Issue #452: Alibaba Cloud OSS rejects path-style URLs with
// "SecondLevelDomainForbidden" and only accepts virtual-hosted style
// (https://bucket.endpoint/key). The flag must reach simples3 so OSS users
// can switch off path-style addressing without code changes.
func TestS3SessionConnectURLStyle(t *testing.T) {
	tests := []struct {
		name              string
		urlStyle          string
		wantVirtualHosted bool
	}{
		{
			name:              "path-style for AWS S3 / MinIO",
			urlStyle:          "path",
			wantVirtualHosted: false,
		},
		{
			name:              "virtual-hosted for OSS / COS / OBS",
			urlStyle:          "virtual",
			wantVirtualHosted: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewS3Session("s3-test")
			cfg := ConnectionConfig{
				Type:       "s3",
				Host:       "oss-cn-hangzhou.aliyuncs.com",
				User:       "ak",
				Password:   "sk",
				S3Region:   "cn-hangzhou",
				S3Bucket:   "mybucket",
				S3URLStyle: tt.urlStyle,
			}
			if err := s.Connect(cfg); err != nil {
				t.Fatalf("Connect failed: %v", err)
			}
			if s.s3 == nil {
				t.Fatal("Connect did not set s3 client")
			}
			if got := s.s3.UseVirtualHostedStyle; got != tt.wantVirtualHosted {
				t.Errorf("UseVirtualHostedStyle = %v, want %v", got, tt.wantVirtualHosted)
			}
			// Endpoint must be normalised (no trailing slash) regardless
			// of what the user typed.
			if s.s3.Endpoint != "oss-cn-hangzhou.aliyuncs.com" {
				t.Errorf("Endpoint = %q, want %q", s.s3.Endpoint, "oss-cn-hangzhou.aliyuncs.com")
			}
		})
	}
}

// TestS3SessionConnectDefaultVirtualHosted covers the chosen default for
// S3URLStyle: empty string (or "virtual") → virtual-hosted style. This is
// what the project picked for issue #452 to unblock Alibaba Cloud OSS /
// Tencent COS / Huawei OBS users out of the box. AWS S3 / MinIO users that
// need the legacy path-style behaviour can opt back in via the S3 form
// by picking "Path" in the URL style dropdown.
func TestS3SessionConnectDefaultVirtualHosted(t *testing.T) {
	cases := []struct {
		name     string
		urlStyle string
	}{
		{"empty string", ""},
		{"explicit virtual", "virtual"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := NewS3Session("s3-default")
			cfg := ConnectionConfig{
				Type:       "s3",
				Host:       "oss-cn-hangzhou.aliyuncs.com",
				User:       "ak",
				Password:   "sk",
				S3Region:   "cn-hangzhou",
				S3Bucket:   "mybucket",
				S3URLStyle: c.urlStyle,
			}
			if err := s.Connect(cfg); err != nil {
				t.Fatalf("Connect failed: %v", err)
			}
			if !s.s3.UseVirtualHostedStyle {
				t.Errorf("default S3URLStyle should enable virtual-hosted, got UseVirtualHostedStyle=false")
			}
		})
	}
}
