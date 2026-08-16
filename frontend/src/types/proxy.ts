export interface Proxy {
  id: string
  name: string
  kind: 'socks5' | 'http'
  host: string
  port: number
  user?: string
  pass?: string
}

export interface ProxyStoreData {
  proxies: Proxy[]
}
