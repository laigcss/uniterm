// K8s 资源描述器的类型定义，从 k8sResources.ts 拆分。

export interface ColoredCell { text: string; tone?: 'ok' | 'warn' | 'err' }

// 指标列需要该行的实时用量（cpu 毫核 / mem 字节），由 K8sResourceList 从
// metricsMap 注入；纯对象列忽略第二参数。
export interface RowUsage { cpu: number; mem: number }

export interface ColumnDef {
  header: string
  value: (obj: any, usage?: RowUsage | null) => string | number | ColoredCell
  width?: number
  filterable?: { type: 'enum' }
  // 顶部筛选框会匹配该列文本（除 name 外，name 始终参与）。
  searchable?: boolean
  // 排序数值：带单位/百分比等文本列（cpu 毫核、内存字节等）返回可比数字，
  // 优先于文本比较，避免 "10m" < "2m" 这类字母序错误。
  sortValue?: (obj: any, usage?: RowUsage | null) => number
}

export type ResourceGroup = 'workloads' | 'network' | 'config' | 'storage' | 'rbac' | 'cluster'

export type ResourceAction =
  | 'detail' | 'delete' | 'restart' | 'scale' | 'viewPods' | 'logs' | 'terminal' | 'cordon' | 'drain' | 'files'

export interface DetailField {
  label: string
  value: (obj: any) => string | { text: string; color?: string }
  link?: (obj: any) => void
}
export interface DetailSection { label: string; fields: DetailField[] }

export interface ResourceDescriptor {
  key: string
  kind: string
  apiVersion: string
  namespaced: boolean
  group: ResourceGroup
  icon: string          // lucide 图标名
  label: string
  listPath: (ns: string) => string
  watchPath: (ns: string, rv: string) => string
  columns: ColumnDef[]
  actions?: ResourceAction[]
  detailSections?: DetailSection[]
  canCreate?: boolean
  createTemplate?: (ns: string) => string
  createPath?: (ns: string) => string
  metrics?: 'pod' | 'node'
  // 行健康度：返回 'warn'/'err' 时整行着色（对齐 k9s 高亮非就绪项）；
  // 返回 '' / undefined 表示正常。
  rowTone?: (obj: any) => '' | 'warn' | 'err'
}