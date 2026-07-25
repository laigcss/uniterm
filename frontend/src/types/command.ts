export interface CommandMeta {
  name: string
  description: string
  origin: 'created' | 'imported'
  locked: boolean
  enabled: boolean
  sortOrder: number
  path: string
  createdAt: string
  version: number
}
