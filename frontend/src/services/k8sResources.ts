// ResourceDescriptor 表驱动 K8sTree + K8sResourceList。
// 每种资源在这里加一条，不写新组件。

export interface ColoredCell { text: string; tone?: 'ok' | 'warn' | 'err' }

export interface ColumnDef {
  header: string
  value: (obj: any) => string | number | ColoredCell
  width?: number
  filterable?: { type: 'enum' }
}

export type ResourceGroup = 'workloads' | 'network' | 'config' | 'storage' | 'rbac' | 'cluster'

export type ResourceAction =
  | 'detail' | 'delete' | 'restart' | 'scale' | 'viewPods' | 'logs' | 'terminal' | 'cordon' | 'drain'

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
  createTemplate?: string
  createPath?: (ns: string) => string
  metrics?: 'pod' | 'node'
}

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

function podReady(p: any): string {
  const cs = p.status?.containerStatuses || []
  const ready = cs.filter((c: any) => c.ready).length
  return `${ready}/${cs.length}`
}

function podRestarts(p: any): number {
  const cs = p.status?.containerStatuses || []
  return cs.reduce((sum: number, c: any) => sum + (c.restartCount || 0), 0)
}

// ── 路径 helper ────────────────────────────────────────────────

function coreListPath(plural: string, ns: string): string {
  return ns
    ? `/api/v1/namespaces/${encodeURIComponent(ns)}/${plural}?limit=500`
    : `/api/v1/${plural}?limit=500`
}

function coreWatchPath(plural: string, ns: string, rv: string): string {
  const base = ns
    ? `/api/v1/namespaces/${encodeURIComponent(ns)}/${plural}`
    : `/api/v1/${plural}`
  return `${base}?watch=true&allowWatchBookmarks=true&resourceVersion=${encodeURIComponent(rv || '')}`
}

function apisListPath(group: string, version: string, plural: string, ns: string): string {
  return ns
    ? `/apis/${group}/${version}/namespaces/${encodeURIComponent(ns)}/${plural}?limit=500`
    : `/apis/${group}/${version}/${plural}?limit=500`
}

function apisWatchPath(group: string, version: string, plural: string, ns: string, rv: string): string {
  const base = ns
    ? `/apis/${group}/${version}/namespaces/${encodeURIComponent(ns)}/${plural}`
    : `/apis/${group}/${version}/${plural}`
  return `${base}?watch=true&allowWatchBookmarks=true&resourceVersion=${encodeURIComponent(rv || '')}`
}

// ── 描述器 ────────────────────────────────────────────────────

export const RESOURCES: ResourceDescriptor[] = [
  // ── Workloads ───────────────────────────────────────────────
  {
    key: 'pods', kind: 'Pod', apiVersion: 'v1',
    namespaced: true, group: 'workloads', icon: 'Box', label: 'Pods',
    listPath: ns => coreListPath('pods', ns),
    watchPath: (ns, rv) => coreWatchPath('pods', ns, rv),
    columns: [
      { header: 'Name', value: p => p.metadata?.name || '' },
      { header: 'Namespace', value: p => p.metadata?.namespace || '', filterable: { type: 'enum' } },
      { header: 'Ready', value: podReady, filterable: { type: 'enum' } },
      { header: 'Status', value: p => p.status?.phase || '', filterable: { type: 'enum' } },
      { header: 'Restarts', value: podRestarts },
      { header: 'Age', value: p => age(p.metadata?.creationTimestamp) },
      { header: 'Node', value: p => p.spec?.nodeName || '', filterable: { type: 'enum' } },
    ],
    actions: ['detail', 'logs', 'terminal', 'delete'],
    canCreate: true,
    metrics: 'pod',
    detailSections: [
      { label: 'Metadata', fields: [
        { label: 'Name', value: p => p.metadata?.name || '' },
        { label: 'Namespace', value: p => p.metadata?.namespace || '' },
        { label: 'UID', value: p => p.metadata?.uid || '' },
        { label: 'Created', value: p => p.metadata?.creationTimestamp || '' },
        { label: 'Labels', value: p => Object.entries(p.metadata?.labels || {}).map(([k, v]) => `${k}=${v}`).join('\n') || '—' },
        { label: 'Annotations', value: p => Object.entries(p.metadata?.annotations || {}).map(([k, v]) => `${k}=${v}`).join('\n') || '—' },
        { label: 'Owner', value: p => (p.metadata?.ownerReferences || []).map((o: any) => `${o.kind}/${o.name}`).join(', ') || '—' },
      ]},
      { label: 'Status', fields: [
        { label: 'Phase', value: p => p.status?.phase || '' },
        { label: 'Pod IP', value: p => p.status?.podIP || '' },
        { label: 'Host IP', value: p => p.status?.hostIP || '' },
        { label: 'QoS', value: p => p.status?.qosClass || '' },
        { label: 'Start Time', value: p => p.status?.startTime || '' },
        { label: 'Restarts', value: p => String(podRestarts(p)) },
        { label: 'Conditions', value: p => (p.status?.conditions || []).map((c: any) => `${c.type}=${c.status}`).join('\n') || '—' },
        { label: 'Message', value: p => p.status?.message || '—' },
      ]},
      { label: 'Scheduling', fields: [
        { label: 'Node', value: p => p.spec?.nodeName || '' },
        { label: 'Service Account', value: p => p.spec?.serviceAccountName || p.spec?.serviceAccount || 'default' },
        { label: 'Restart Policy', value: p => p.spec?.restartPolicy || '' },
        { label: 'Node Selector', value: p => Object.entries(p.spec?.nodeSelector || {}).map(([k, v]) => `${k}=${v}`).join('\n') || '—' },
        { label: 'Tolerations', value: p => (p.spec?.tolerations || []).map((t: any) => t.key ? `${t.key}${t.operator === 'Exists' ? '' : '=' + (t.value || '')}${t.effect ? ':' + t.effect : ''}` : (t.operator || '')).join('\n') || '—' },
        { label: 'Priority Class', value: p => p.spec?.priorityClassName || '—' },
      ]},
      { label: 'Containers', fields: [
        { label: 'Containers', value: p => {
          const st = new Map((p.status?.containerStatuses || []).map((s: any) => [s.name, s]))
          return (p.spec?.containers || []).map((c: any) => {
            const s: any = st.get(c.name)
            const state = s?.state ? Object.keys(s.state)[0] : '?'
            const ports = (c.ports || []).map((pt: any) => `${pt.containerPort}/${pt.protocol || 'TCP'}`).join(',')
            const req = c.resources?.requests ? `req ${c.resources.requests.cpu || '-'}/${c.resources.requests.memory || '-'}` : ''
            const lim = c.resources?.limits ? `lim ${c.resources.limits.cpu || '-'}/${c.resources.limits.memory || '-'}` : ''
            return [
              `▸ ${c.name}`,
              `   image: ${c.image}`,
              `   state: ${state}  ready: ${s?.ready ? 'yes' : 'no'}  restarts: ${s?.restartCount ?? 0}`,
              ports ? `   ports: ${ports}` : '',
              (req || lim) ? `   resources: ${[req, lim].filter(Boolean).join('  ')}` : '',
            ].filter(Boolean).join('\n')
          }).join('\n\n')
        } },
      ]},
      { label: 'Volumes', fields: [
        { label: 'Volumes', value: p => (p.spec?.volumes || []).map((v: any) => {
          const type = Object.keys(v).find(k => k !== 'name') || '?'
          return `${v.name} (${type})`
        }).join('\n') || '—' },
      ]},
    ],
  },
  {
    key: 'deployments', kind: 'Deployment', apiVersion: 'apps/v1',
    namespaced: true, group: 'workloads', icon: 'Layers', label: 'Deployments',
    listPath: ns => apisListPath('apps', 'v1', 'deployments', ns),
    watchPath: (ns, rv) => apisWatchPath('apps', 'v1', 'deployments', ns, rv),
    columns: [
      { header: 'Name', value: d => d.metadata?.name || '' },
      { header: 'Namespace', value: d => d.metadata?.namespace || '' },
      { header: 'Ready', value: d => `${d.status?.readyReplicas || 0}/${d.spec?.replicas ?? 0}` },
      { header: 'Up-to-date', value: d => d.status?.updatedReplicas || 0 },
      { header: 'Available', value: d => d.status?.availableReplicas || 0 },
      { header: 'Age', value: d => age(d.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'restart', 'scale', 'delete'],
    canCreate: true,
  },
  {
    key: 'statefulsets', kind: 'StatefulSet', apiVersion: 'apps/v1',
    namespaced: true, group: 'workloads', icon: 'Boxes', label: 'StatefulSets',
    listPath: ns => apisListPath('apps', 'v1', 'statefulsets', ns),
    watchPath: (ns, rv) => apisWatchPath('apps', 'v1', 'statefulsets', ns, rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Namespace', value: s => s.metadata?.namespace || '' },
      { header: 'Ready', value: s => `${s.status?.readyReplicas || 0}/${s.spec?.replicas ?? 0}` },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'restart', 'scale', 'delete'],
    canCreate: true,
  },
  {
    key: 'daemonsets', kind: 'DaemonSet', apiVersion: 'apps/v1',
    namespaced: true, group: 'workloads', icon: 'GitFork', label: 'DaemonSets',
    listPath: ns => apisListPath('apps', 'v1', 'daemonsets', ns),
    watchPath: (ns, rv) => apisWatchPath('apps', 'v1', 'daemonsets', ns, rv),
    columns: [
      { header: 'Name', value: d => d.metadata?.name || '' },
      { header: 'Namespace', value: d => d.metadata?.namespace || '' },
      { header: 'Desired', value: d => d.status?.desiredNumberScheduled || 0 },
      { header: 'Current', value: d => d.status?.currentNumberScheduled || 0 },
      { header: 'Ready', value: d => d.status?.numberReady || 0 },
      { header: 'Age', value: d => age(d.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'restart', 'delete'],
    canCreate: true,
  },
  {
    key: 'jobs', kind: 'Job', apiVersion: 'batch/v1',
    namespaced: true, group: 'workloads', icon: 'PlayCircle', label: 'Jobs',
    listPath: ns => apisListPath('batch', 'v1', 'jobs', ns),
    watchPath: (ns, rv) => apisWatchPath('batch', 'v1', 'jobs', ns, rv),
    columns: [
      { header: 'Name', value: j => j.metadata?.name || '' },
      { header: 'Namespace', value: j => j.metadata?.namespace || '' },
      { header: 'Completions', value: j => `${j.status?.succeeded || 0}/${j.spec?.completions ?? 1}` },
      { header: 'Age', value: j => age(j.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'delete'],
    canCreate: true,
  },
  {
    key: 'cronjobs', kind: 'CronJob', apiVersion: 'batch/v1',
    namespaced: true, group: 'workloads', icon: 'Clock', label: 'CronJobs',
    listPath: ns => apisListPath('batch', 'v1', 'cronjobs', ns),
    watchPath: (ns, rv) => apisWatchPath('batch', 'v1', 'cronjobs', ns, rv),
    columns: [
      { header: 'Name', value: c => c.metadata?.name || '' },
      { header: 'Namespace', value: c => c.metadata?.namespace || '' },
      { header: 'Schedule', value: c => c.spec?.schedule || '' },
      { header: 'Suspend', value: c => c.spec?.suspend ? 'true' : 'false' },
      { header: 'Active', value: c => (c.status?.active || []).length },
      { header: 'Last Schedule', value: c => age(c.status?.lastScheduleTime) },
      { header: 'Age', value: c => age(c.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  {
    key: 'replicasets', kind: 'ReplicaSet', apiVersion: 'apps/v1',
    namespaced: true, group: 'workloads', icon: 'Copy', label: 'ReplicaSets',
    listPath: ns => apisListPath('apps', 'v1', 'replicasets', ns),
    watchPath: (ns, rv) => apisWatchPath('apps', 'v1', 'replicasets', ns, rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'Namespace', value: r => r.metadata?.namespace || '' },
      { header: 'Desired', value: r => r.spec?.replicas ?? 0 },
      { header: 'Ready', value: r => r.status?.readyReplicas || 0 },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'scale', 'delete'],
    canCreate: true,
  },
  // ── Network ─────────────────────────────────────────────────
  {
    key: 'services', kind: 'Service', apiVersion: 'v1',
    namespaced: true, group: 'network', icon: 'Network', label: 'Services',
    listPath: ns => coreListPath('services', ns),
    watchPath: (ns, rv) => coreWatchPath('services', ns, rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Namespace', value: s => s.metadata?.namespace || '' },
      { header: 'Type', value: s => s.spec?.type || '', filterable: { type: 'enum' } },
      { header: 'Cluster-IP', value: s => s.spec?.clusterIP || '' },
      { header: 'Ports', value: s => (s.spec?.ports || []).map((p: any) => `${p.port}/${p.protocol || 'TCP'}`).join(',') },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  {
    key: 'ingresses', kind: 'Ingress', apiVersion: 'networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'Globe', label: 'Ingresses',
    listPath: ns => apisListPath('networking.k8s.io', 'v1', 'ingresses', ns),
    watchPath: (ns, rv) => apisWatchPath('networking.k8s.io', 'v1', 'ingresses', ns, rv),
    columns: [
      { header: 'Name', value: i => i.metadata?.name || '' },
      { header: 'Namespace', value: i => i.metadata?.namespace || '' },
      { header: 'Class', value: i => i.spec?.ingressClassName || '' },
      { header: 'Hosts', value: i => (i.spec?.rules || []).map((r: any) => r.host).filter(Boolean).join(',') || '*' },
      { header: 'Age', value: i => age(i.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  // ── Config ──────────────────────────────────────────────────
  {
    key: 'configmaps', kind: 'ConfigMap', apiVersion: 'v1',
    namespaced: true, group: 'config', icon: 'FileText', label: 'ConfigMaps',
    listPath: ns => coreListPath('configmaps', ns),
    watchPath: (ns, rv) => coreWatchPath('configmaps', ns, rv),
    columns: [
      { header: 'Name', value: c => c.metadata?.name || '' },
      { header: 'Namespace', value: c => c.metadata?.namespace || '' },
      { header: 'Data', value: c => Object.keys(c.data || {}).length },
      { header: 'Age', value: c => age(c.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  {
    key: 'secrets', kind: 'Secret', apiVersion: 'v1',
    namespaced: true, group: 'config', icon: 'Lock', label: 'Secrets',
    listPath: ns => coreListPath('secrets', ns),
    watchPath: (ns, rv) => coreWatchPath('secrets', ns, rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Namespace', value: s => s.metadata?.namespace || '' },
      { header: 'Type', value: s => s.type || '' },
      { header: 'Data', value: s => Object.keys(s.data || {}).length },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  // ── Storage ─────────────────────────────────────────────────
  {
    key: 'persistentvolumeclaims', kind: 'PersistentVolumeClaim', apiVersion: 'v1',
    namespaced: true, group: 'storage', icon: 'HardDrive', label: 'PVCs',
    listPath: ns => coreListPath('persistentvolumeclaims', ns),
    watchPath: (ns, rv) => coreWatchPath('persistentvolumeclaims', ns, rv),
    columns: [
      { header: 'Name', value: p => p.metadata?.name || '' },
      { header: 'Namespace', value: p => p.metadata?.namespace || '' },
      { header: 'Status', value: p => p.status?.phase || '', filterable: { type: 'enum' } },
      { header: 'Volume', value: p => p.spec?.volumeName || '' },
      { header: 'Capacity', value: p => p.status?.capacity?.storage || '' },
      { header: 'Storage Class', value: p => p.spec?.storageClassName || '' },
      { header: 'Age', value: p => age(p.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  {
    key: 'persistentvolumes', kind: 'PersistentVolume', apiVersion: 'v1',
    namespaced: false, group: 'storage', icon: 'Database', label: 'PVs',
    listPath: () => coreListPath('persistentvolumes', ''),
    watchPath: (_ns, rv) => coreWatchPath('persistentvolumes', '', rv),
    columns: [
      { header: 'Name', value: p => p.metadata?.name || '' },
      { header: 'Capacity', value: p => p.spec?.capacity?.storage || '' },
      { header: 'Access', value: p => (p.spec?.accessModes || []).join(',') },
      { header: 'Reclaim', value: p => p.spec?.persistentVolumeReclaimPolicy || '' },
      { header: 'Status', value: p => p.status?.phase || '', filterable: { type: 'enum' } },
      { header: 'Claim', value: p => p.spec?.claimRef ? `${p.spec.claimRef.namespace}/${p.spec.claimRef.name}` : '' },
      { header: 'Storage Class', value: p => p.spec?.storageClassName || '' },
      { header: 'Age', value: p => age(p.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
  },
  // ── Cluster ─────────────────────────────────────────────────
  {
    key: 'nodes', kind: 'Node', apiVersion: 'v1',
    namespaced: false, group: 'cluster', icon: 'Server', label: 'Nodes',
    listPath: () => coreListPath('nodes', ''),
    watchPath: (_ns, rv) => coreWatchPath('nodes', '', rv),
    columns: [
      { header: 'Name', value: n => n.metadata?.name || '' },
      { header: 'Status', value: n => {
        const c = (n.status?.conditions || []).find((c: any) => c.type === 'Ready')
        return c?.status === 'True' ? 'Ready' : 'NotReady'
      }, filterable: { type: 'enum' } },
      { header: 'Roles', value: n => Object.keys(n.metadata?.labels || {})
          .filter(l => l.startsWith('node-role.kubernetes.io/'))
          .map(l => l.substring('node-role.kubernetes.io/'.length))
          .join(',') || '<none>' },
      { header: 'Version', value: n => n.status?.nodeInfo?.kubeletVersion || '' },
      { header: 'Internal-IP', value: n => (n.status?.addresses || []).find((a: any) => a.type === 'InternalIP')?.address || '' },
      { header: 'OS', value: n => n.status?.nodeInfo?.osImage || '' },
      { header: 'Age', value: n => age(n.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'cordon', 'drain'],
    canCreate: false,
    metrics: 'node',
  },
  {
    key: 'namespaces', kind: 'Namespace', apiVersion: 'v1',
    namespaced: false, group: 'cluster', icon: 'Folder', label: 'Namespaces',
    listPath: () => coreListPath('namespaces', ''),
    watchPath: (_ns, rv) => coreWatchPath('namespaces', '', rv),
    columns: [
      { header: 'Name', value: n => n.metadata?.name || '' },
      { header: 'Status', value: n => n.status?.phase || '', filterable: { type: 'enum' } },
      { header: 'Age', value: n => age(n.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: false,
  },
  {
    key: 'events', kind: 'Event', apiVersion: 'v1',
    namespaced: true, group: 'cluster', icon: 'Bell', label: 'Events',
    listPath: ns => coreListPath('events', ns),
    watchPath: (ns, rv) => coreWatchPath('events', ns, rv),
    columns: [
      { header: 'Type', value: e => e.type || '', filterable: { type: 'enum' } },
      { header: 'Reason', value: e => e.reason || '' },
      { header: 'Object', value: e => `${e.involvedObject?.kind}/${e.involvedObject?.name || ''}` },
      { header: 'Message', value: e => e.message || '' },
      { header: 'Namespace', value: e => e.metadata?.namespace || '' },
      { header: 'Age', value: e => age(e.metadata?.creationTimestamp || e.lastTimestamp) },
    ],
    actions: ['detail'],
    canCreate: false,
  },
  // ── Workloads (autoscaling) ─────────────────────────────────
  {
    key: 'horizontalpodautoscalers', kind: 'HorizontalPodAutoscaler', apiVersion: 'autoscaling/v2',
    namespaced: true, group: 'workloads', icon: 'GitFork', label: 'HPAs',
    listPath: ns => apisListPath('autoscaling', 'v2', 'horizontalpodautoscalers', ns),
    watchPath: (ns, rv) => apisWatchPath('autoscaling', 'v2', 'horizontalpodautoscalers', ns, rv),
    columns: [
      { header: 'Name', value: h => h.metadata?.name || '' },
      { header: 'Namespace', value: h => h.metadata?.namespace || '' },
      { header: 'Reference', value: h => `${h.spec?.scaleTargetRef?.kind || ''}/${h.spec?.scaleTargetRef?.name || ''}` },
      { header: 'Min', value: h => h.spec?.minReplicas ?? 0 },
      { header: 'Max', value: h => h.spec?.maxReplicas ?? 0 },
      { header: 'Replicas', value: h => h.status?.currentReplicas ?? 0 },
      { header: 'Age', value: h => age(h.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  // ── Network ─────────────────────────────────────────────────
  {
    key: 'networkpolicies', kind: 'NetworkPolicy', apiVersion: 'networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'BrickWallShield', label: 'NetworkPolicies',
    listPath: ns => apisListPath('networking.k8s.io', 'v1', 'networkpolicies', ns),
    watchPath: (ns, rv) => apisWatchPath('networking.k8s.io', 'v1', 'networkpolicies', ns, rv),
    columns: [
      { header: 'Name', value: n => n.metadata?.name || '' },
      { header: 'Namespace', value: n => n.metadata?.namespace || '' },
      { header: 'Pod-Selector', value: n => Object.entries(n.spec?.podSelector?.matchLabels || {}).map(([k, v]) => `${k}=${v}`).join(',') || '<all>' },
      { header: 'Age', value: n => age(n.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  {
    key: 'endpoints', kind: 'Endpoints', apiVersion: 'v1',
    namespaced: true, group: 'network', icon: 'Cable', label: 'Endpoints',
    listPath: ns => coreListPath('endpoints', ns),
    watchPath: (ns, rv) => coreWatchPath('endpoints', ns, rv),
    columns: [
      { header: 'Name', value: e => e.metadata?.name || '' },
      { header: 'Namespace', value: e => e.metadata?.namespace || '' },
      { header: 'Endpoints', value: e => (e.subsets || []).flatMap((s: any) => (s.addresses || []).map((a: any) => a.ip)).slice(0, 5).join(',') },
      { header: 'Age', value: e => age(e.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: false,
  },
  // ── Config (quota) ──────────────────────────────────────────
  {
    key: 'resourcequotas', kind: 'ResourceQuota', apiVersion: 'v1',
    namespaced: true, group: 'config', icon: 'File', label: 'ResourceQuotas',
    listPath: ns => coreListPath('resourcequotas', ns),
    watchPath: (ns, rv) => coreWatchPath('resourcequotas', ns, rv),
    columns: [
      { header: 'Name', value: q => q.metadata?.name || '' },
      { header: 'Namespace', value: q => q.metadata?.namespace || '' },
      { header: 'Age', value: q => age(q.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  {
    key: 'limitranges', kind: 'LimitRange', apiVersion: 'v1',
    namespaced: true, group: 'config', icon: 'File', label: 'LimitRanges',
    listPath: ns => coreListPath('limitranges', ns),
    watchPath: (ns, rv) => coreWatchPath('limitranges', ns, rv),
    columns: [
      { header: 'Name', value: l => l.metadata?.name || '' },
      { header: 'Namespace', value: l => l.metadata?.namespace || '' },
      { header: 'Age', value: l => age(l.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  // ── Storage ─────────────────────────────────────────────────
  {
    key: 'storageclasses', kind: 'StorageClass', apiVersion: 'storage.k8s.io/v1',
    namespaced: false, group: 'storage', icon: 'Layers', label: 'StorageClasses',
    listPath: () => apisListPath('storage.k8s.io', 'v1', 'storageclasses', ''),
    watchPath: (_ns, rv) => apisWatchPath('storage.k8s.io', 'v1', 'storageclasses', '', rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Provisioner', value: s => s.provisioner || '' },
      { header: 'Reclaim', value: s => s.reclaimPolicy || '' },
      { header: 'Binding', value: s => s.volumeBindingMode || '' },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  // ── RBAC ────────────────────────────────────────────────────
  {
    key: 'serviceaccounts', kind: 'ServiceAccount', apiVersion: 'v1',
    namespaced: true, group: 'rbac', icon: 'Lock', label: 'ServiceAccounts',
    listPath: ns => coreListPath('serviceaccounts', ns),
    watchPath: (ns, rv) => coreWatchPath('serviceaccounts', ns, rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Namespace', value: s => s.metadata?.namespace || '' },
      { header: 'Secrets', value: s => (s.secrets || []).length },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  {
    key: 'roles', kind: 'Role', apiVersion: 'rbac.authorization.k8s.io/v1',
    namespaced: true, group: 'rbac', icon: 'Lock', label: 'Roles',
    listPath: ns => apisListPath('rbac.authorization.k8s.io', 'v1', 'roles', ns),
    watchPath: (ns, rv) => apisWatchPath('rbac.authorization.k8s.io', 'v1', 'roles', ns, rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'Namespace', value: r => r.metadata?.namespace || '' },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  {
    key: 'rolebindings', kind: 'RoleBinding', apiVersion: 'rbac.authorization.k8s.io/v1',
    namespaced: true, group: 'rbac', icon: 'Lock', label: 'RoleBindings',
    listPath: ns => apisListPath('rbac.authorization.k8s.io', 'v1', 'rolebindings', ns),
    watchPath: (ns, rv) => apisWatchPath('rbac.authorization.k8s.io', 'v1', 'rolebindings', ns, rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'Namespace', value: r => r.metadata?.namespace || '' },
      { header: 'Role', value: r => `${r.roleRef?.kind || ''}/${r.roleRef?.name || ''}` },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  {
    key: 'clusterroles', kind: 'ClusterRole', apiVersion: 'rbac.authorization.k8s.io/v1',
    namespaced: false, group: 'rbac', icon: 'Lock', label: 'ClusterRoles',
    listPath: () => apisListPath('rbac.authorization.k8s.io', 'v1', 'clusterroles', ''),
    watchPath: (_ns, rv) => apisWatchPath('rbac.authorization.k8s.io', 'v1', 'clusterroles', '', rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  {
    key: 'clusterrolebindings', kind: 'ClusterRoleBinding', apiVersion: 'rbac.authorization.k8s.io/v1',
    namespaced: false, group: 'rbac', icon: 'Lock', label: 'ClusterRoleBindings',
    listPath: () => apisListPath('rbac.authorization.k8s.io', 'v1', 'clusterrolebindings', ''),
    watchPath: (_ns, rv) => apisWatchPath('rbac.authorization.k8s.io', 'v1', 'clusterrolebindings', '', rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'Role', value: r => `${r.roleRef?.kind || ''}/${r.roleRef?.name || ''}` },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
  // ── Cluster (CRD) ───────────────────────────────────────────
  {
    key: 'customresourcedefinitions', kind: 'CustomResourceDefinition', apiVersion: 'apiextensions.k8s.io/v1',
    namespaced: false, group: 'cluster', icon: 'Component', label: 'CRDs',
    listPath: () => apisListPath('apiextensions.k8s.io', 'v1', 'customresourcedefinitions', ''),
    watchPath: (_ns, rv) => apisWatchPath('apiextensions.k8s.io', 'v1', 'customresourcedefinitions', '', rv),
    columns: [
      { header: 'Name', value: c => c.metadata?.name || '' },
      { header: 'Group', value: c => c.spec?.group || '' },
      { header: 'Kind', value: c => c.spec?.names?.kind || '' },
      { header: 'Scope', value: c => c.spec?.scope || '' },
      { header: 'Age', value: c => age(c.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
  },
]

export function getResource(key: string): ResourceDescriptor | undefined {
  return RESOURCES.find(r => r.key === key)
}
