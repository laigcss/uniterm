package session

// Proxy is a reusable outbound proxy (SOCKS5/HTTP) stored in proxies.json,
// mirroring Identity in the credential vault. Pass is decrypted in memory and
// encrypted at rest.
type Proxy struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // "socks5" | "http"
	Host string `json:"host"`
	Port int    `json:"port"`
	User string `json:"user,omitempty"`
	Pass string `json:"pass,omitempty"`
}

// ProxyStoreData is the top-level shape of proxies.json.
type ProxyStoreData struct {
	Proxies []Proxy `json:"proxies"`
}

// ProxyResolver resolves a Proxy ID into the runtime SocksProxy dial struct
// (Kind/Host/Port/User/Pass), consumed directly by dialFirstHop.
type ProxyResolver func(id string) (SocksProxy, bool)
