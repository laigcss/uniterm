// K8s 资源 helper 函数和路径 helper，从 k8sResources.ts 拆分。

import { parseCpu, parseMemory } from './k8sQuantity'
import type { DetailSection } from './k8sResourceTypes'

// ── 通用列生成器 ────────────────────────────────────────────────

export function age(ts: string | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function podReady(p: any): string {
  const cs = p.status?.containerStatuses || []
  const ready = cs.filter((c: any) => c.ready).length
  return `${ready}/${cs.length}`
}

export function podRestarts(p: any): number {
  const cs = p.status?.containerStatuses || []
  return cs.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0)
}

// pod 各容器 requests/limits 的合计（cpu 毫核 / mem 字节）。
export function podResourceTotals(p: any): { cpuReq: number; cpuLim: number; memReq: number; memLim: number } {
  let cpuReq = 0, cpuLim = 0, memReq = 0, memLim = 0
  for (const c of p.spec?.containers || []) {
    cpuReq += parseCpu(c.resources?.requests?.cpu || '')
    cpuLim += parseCpu(c.resources?.limits?.cpu || '')
    memReq += parseMemory(c.resources?.requests?.memory || '')
    memLim += parseMemory(c.resources?.limits?.memory || '')
  }
  return { cpuReq, cpuLim, memReq, memLim }
}

// k9s 风格的 pod 状态：优先反映容器/初始化异常，而非只看 phase。
export function podStatus(p: any): string {
  if (p.metadata?.deletionTimestamp) return 'Terminating'
  const reason = p.status?.reason
  if (reason) return reason
  const css = p.status?.containerStatuses || []
  for (const cs of css) {
    const w = cs.state?.waiting?.reason
    const term = cs.state?.terminated?.reason
    if (w && w !== 'ContainerCreating') return w
    if (term && term !== 'Completed') return term
  }
  return p.status?.phase || ''
}

// pod 行健康度：Running/Succeeded 且容器全就绪为正常；否则告警/错误。
export function podTone(p: any): '' | 'warn' | 'err' {
  if (p.metadata?.deletionTimestamp) return 'warn'
  const st = podStatus(p)
  if (st === 'Running' || st === 'Completed' || st === 'Succeeded') {
    const cs = p.status?.containerStatuses || []
    if (cs.length && !cs.every((c: any) => c.ready) && st === 'Running') return 'warn'
    return ''
  }
  if (st === 'Pending' || st === 'ContainerCreating' || st === 'PodInitializing') return 'warn'
  return 'err'
}

// 副本类工作负载：ready < desired 视为告警。
export function replicaTone(ready: number, desired: number): '' | 'warn' | 'err' {
  if (desired > 0 && ready < desired) return ready === 0 ? 'err' : 'warn'
  return ''
}

// duration between two ISO timestamps, formatted like age().
export function durationBetween(start?: string, end?: string): string {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const diff = Math.floor((e - s) / 1000)
  if (diff < 0) return '—'
  if (diff < 60) return `${diff}s`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// k9s Service ports 格式：`name:port►nodePort╱protocol`，多个用空格分隔。
export function servicePorts(s: any): string {
  return (s.spec?.ports || []).map((p: any) => {
    const name = p.name ? `${p.name}:` : ''
    const proto = (p.protocol && p.protocol !== 'TCP') ? `╱${p.protocol}` : ''
    return `${name}${p.port}►${p.nodePort || 0}${proto}`
  }).join(' ')
}

// NetworkPolicy ingress/egress 的端口与 block CIDR 提取。
export function npPorts(rules: any[]): string {
  const set = new Set<string>()
  for (const r of rules || []) for (const p of r.ports || []) set.add(`${p.port ?? '*'}/${p.protocol || 'TCP'}`)
  return Array.from(set).join(',') || '—'
}
export function npBlocks(rules: any[], peerKey: string): string {
  const set = new Set<string>()
  for (const r of rules || []) for (const peer of r[peerKey] || []) if (peer.ipBlock?.cidr) set.add(peer.ipBlock.cidr)
  return Array.from(set).join(',') || '—'
}

export function kv(obj: Record<string, any> | undefined): string {
  return Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('\n') || '—'
}

// ResourceQuota 的 requests.*/limits.* 用量，形如 `cpu: 2/4`。
export function quotaByPrefix(q: any, prefix: string): string {
  const used = q.status?.used || {}
  const hard = q.status?.hard || {}
  const keys = Object.keys(hard).filter(k => k.startsWith(prefix))
  return keys.map(k => `${k.slice(prefix.length)}: ${used[k] ?? 0}/${hard[k]}`).join(', ') || '—'
}
export function quotaRequest(q: any): string { return quotaByPrefix(q, 'requests.') }
export function quotaLimit(q: any): string { return quotaByPrefix(q, 'limits.') }

// RBAC 规则简表：`apiGroups|resources → verbs`，逐行。
export function rbacRules(o: any): string {
  return (o.rules || []).map((r: any) => {
    const groups = (r.apiGroups || ['']).map((g: string) => g || 'core').join(',')
    const res = (r.resources || []).join(',')
    const verbs = (r.verbs || []).join(',')
    return `${groups}/${res} → ${verbs}`
  }).join('\n') || '—'
}

// RBAC 主体简表：`Kind/name`，逐行。
export function rbacSubjects(o: any): string {
  return (o.subjects || []).map((s: any) => `${s.kind}/${s.namespace ? s.namespace + ':' : ''}${s.name}`).join('\n') || '—'
}

// 通用 Metadata 详情段，供各资源的 detailSections 复用。
export function metaSection(): DetailSection {
  return { label: 'Metadata', fields: [
    { label: 'Name', value: (o: any) => o.metadata?.name || '' },
    { label: 'Namespace', value: (o: any) => o.metadata?.namespace || 'cluster' },
    { label: 'UID', value: (o: any) => o.metadata?.uid || '' },
    { label: 'Created', value: (o: any) => o.metadata?.creationTimestamp || '' },
    { label: 'Labels', value: (o: any) => kv(o.metadata?.labels) },
    { label: 'Annotations', value: (o: any) => kv(o.metadata?.annotations) },
    { label: 'Owner', value: (o: any) => (o.metadata?.ownerReferences || []).map((r: any) => `${r.kind}/${r.name}`).join(', ') || '—' },
  ] }
}

// metaSection + 额外字段段，减少各资源重复。
export function withMeta(...sections: DetailSection[]): DetailSection[] {
  return [metaSection(), ...sections]
}

// 资源未定义 detailSections 时的兜底：完整 Metadata + 常见 Spec/Status 概要。
export function genericDetailSections(): DetailSection[] {
  return [
    metaSection(),
    { label: 'Status', fields: [
      { label: 'Phase', value: (o: any) => o.status?.phase || o.status?.state || '—' },
      { label: 'Conditions', value: (o: any) => (o.status?.conditions || []).map((c: any) => `${c.type}=${c.status}`).join('\n') || '—' },
    ] },
  ]
}

// 工作负载（Deployment/StatefulSet/DaemonSet/ReplicaSet）通用的 Spec + Status 段。
export function selectorText(o: any): string {
  return kv(o.spec?.selector?.matchLabels)
}

// Endpoints 展开为 `ip:port,ip:port,...`（address × port 笛卡尔积）。
export function endpointsText(e: any): string {
  const out: string[] = []
  for (const s of e.subsets || []) {
    const ports = (s.ports || []).map((p: any) => p.port)
    for (const a of s.addresses || []) {
      if (ports.length) for (const p of ports) out.push(`${a.ip}:${p}`)
      else out.push(a.ip)
    }
  }
  return out.join(',') || '<none>'
}

// HPA current/target 指标，形如 `cpu: 40%/80%`；多指标用逗号分隔。
export function hpaTargets(h: any): string {
  const cur = new Map<string, string>()
  for (const m of h.status?.currentMetrics || []) {
    if (m.resource) cur.set(m.resource.name, m.resource.current?.averageUtilization != null ? `${m.resource.current.averageUtilization}%` : (m.resource.current?.averageValue || '?'))
  }
  const specs = (h.spec?.metrics || []).map((m: any) => {
    if (m.resource) {
      const tgt = m.resource.target?.averageUtilization != null ? `${m.resource.target.averageUtilization}%` : (m.resource.target?.averageValue || '?')
      return `${cur.get(m.resource.name) || '?'}/${tgt}`
    }
    return '?'
  })
  return specs.join(',') || '<none>'
}

// ── 路径 helper ────────────────────────────────────────────────

export function coreListPath(plural: string, ns: string): string {
  return ns
    ? `/api/v1/namespaces/${encodeURIComponent(ns)}/${plural}?limit=500`
    : `/api/v1/${plural}?limit=500`
}

export function coreWatchPath(plural: string, ns: string, rv: string): string {
  const base = ns
    ? `/api/v1/namespaces/${encodeURIComponent(ns)}/${plural}`
    : `/api/v1/${plural}`
  return `${base}?watch=true&allowWatchBookmarks=true&resourceVersion=${encodeURIComponent(rv || '')}`
}

export function apisListPath(group: string, version: string, plural: string, ns: string): string {
  return ns
    ? `/apis/${group}/${version}/namespaces/${encodeURIComponent(ns)}/${plural}?limit=500`
    : `/apis/${group}/${version}/${plural}?limit=500`
}

export function apisWatchPath(group: string, version: string, plural: string, ns: string, rv: string): string {
  const base = ns
    ? `/apis/${group}/${version}/namespaces/${encodeURIComponent(ns)}/${plural}`
    : `/apis/${group}/${version}/${plural}`
  return `${base}?watch=true&allowWatchBookmarks=true&resourceVersion=${encodeURIComponent(rv || '')}`
}
