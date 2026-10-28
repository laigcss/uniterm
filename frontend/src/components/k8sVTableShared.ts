// K8sVTable 子组件与 K8sResourceList 容器共享的类型与工具函数。

export interface VCol {
  header: string
  width?: number
  getText: (row: any) => string
  sortable?: boolean
  filterable?: boolean
  sortNum?: (row: any) => number
}

export const VROW_HEIGHT = 36

export function cellText(v: string | number | { text: string; tone?: string }): string {
  if (v == null) return ''
  if (typeof v === 'object' && 'text' in v) return v.text
  return String(v)
}