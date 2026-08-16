export interface Identity {
  id: string
  name: string
  username: string
  authType: 'password' | 'key'
  password?: string
  keyPath?: string
}

export interface IdentityStoreData {
  identities: Identity[]
}
