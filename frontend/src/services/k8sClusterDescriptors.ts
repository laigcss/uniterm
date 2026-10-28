// Cluster 资源描述器：nodes, namespaces, events, customresourcedefinitions。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, withMeta, coreListPath, coreWatchPath, apisListPath, apisWatchPath } from './k8sResourceHelpers'
import { formatCpu, formatMemory, percent, parseCpu, parseMemory } from './k8sQuantity'

export const CLUSTER_DESCRIPTORS: ResourceDescriptor[] = [
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
          .join(',') || '<none>', searchable: true },
      { header: 'Taints', value: n => (n.spec?.taints || []).length || 0, width: 70 },
      { header: 'Version', value: n => n.status?.nodeInfo?.kubeletVersion || '', searchable: true },
      { header: 'Internal-IP', value: n => (n.status?.addresses || []).find((a: any) => a.type === 'InternalIP')?.address || '', searchable: true },
      { header: 'Pods', value: n => n.status?.allocatable?.pods || n.status?.capacity?.pods || '', width: 70 },
      { header: 'CPU', value: (_n, u) => u ? formatCpu(u.cpu) : '—', width: 80, sortValue: (_n, u) => u?.cpu ?? -1 },
      { header: 'MEM', value: (_n, u) => u ? formatMemory(u.mem) : '—', width: 80, sortValue: (_n, u) => u?.mem ?? -1 },
      { header: '%CPU', value: (n, u) => u ? percent(u.cpu, parseCpu(n.status?.allocatable?.cpu)) : '—', width: 70 },
      { header: '%MEM', value: (n, u) => u ? percent(u.mem, parseMemory(n.status?.allocatable?.memory)) : '—', width: 70 },
      { header: 'OS', value: n => n.status?.nodeInfo?.osImage || '' },
      { header: 'Kernel', value: n => n.status?.nodeInfo?.kernelVersion || '' },
      { header: 'Container-Runtime', value: n => n.status?.nodeInfo?.containerRuntimeVersion || '' },
      { header: 'Age', value: n => age(n.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'cordon', 'drain'],
    canCreate: false,
    metrics: 'node',
    rowTone: n => {
      const c = (n.status?.conditions || []).find((x: any) => x.type === 'Ready')
      if (c?.status !== 'True') return 'err'
      return n.spec?.unschedulable ? 'warn' : ''
    },
    detailSections: withMeta(
      { label: 'Info', fields: [
        { label: 'Kubelet', value: n => n.status?.nodeInfo?.kubeletVersion || '' },
        { label: 'OS Image', value: n => n.status?.nodeInfo?.osImage || '' },
        { label: 'Kernel', value: n => n.status?.nodeInfo?.kernelVersion || '' },
        { label: 'Container Runtime', value: n => n.status?.nodeInfo?.containerRuntimeVersion || '' },
        { label: 'Architecture', value: n => n.status?.nodeInfo?.architecture || '' },
        { label: 'Roles', value: n => Object.keys(n.metadata?.labels || {}).filter(l => l.startsWith('node-role.kubernetes.io/')).map(l => l.substring('node-role.kubernetes.io/'.length)).join(',') || '<none>' },
      ]},
      { label: 'Scheduling', fields: [
        { label: 'Unschedulable', value: n => n.spec?.unschedulable ? 'true' : 'false' },
        { label: 'Taints', value: n => (n.spec?.taints || []).map((t: any) => `${t.key}${t.value ? '=' + t.value : ''}:${t.effect}`).join('\n') || '—' },
      ]},
      { label: 'Capacity', fields: [
        { label: 'CPU', value: n => n.status?.capacity?.cpu || '' },
        { label: 'Memory', value: n => n.status?.capacity?.memory || '' },
        { label: 'Pods', value: n => n.status?.capacity?.pods || '' },
      ]},
      { label: 'Addresses', fields: [
        { label: 'Addresses', value: n => (n.status?.addresses || []).map((a: any) => `${a.type}: ${a.address}`).join('\n') || '—' },
      ]},
      { label: 'Conditions', fields: [
        { label: 'Conditions', value: n => (n.status?.conditions || []).map((c: any) => `${c.type}=${c.status}`).join('\n') || '—' },
      ]},
    ),
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
    detailSections: withMeta(
      { label: 'Status', fields: [
        { label: 'Phase', value: n => n.status?.phase || '' },
      ]},
    ),
  },
  {
    key: 'events', kind: 'Event', apiVersion: 'v1',
    namespaced: true, group: 'cluster', icon: 'Bell', label: 'Events',
    listPath: ns => coreListPath('events', ns),
    watchPath: (ns, rv) => coreWatchPath('events', ns, rv),
    columns: [
      { header: 'Type', value: e => e.type || '', filterable: { type: 'enum' } },
      { header: 'Reason', value: e => e.reason || '', searchable: true },
      { header: 'Object', value: e => `${e.involvedObject?.kind}/${e.involvedObject?.name || ''}`, searchable: true },
      { header: 'Message', value: e => e.message || '', searchable: true },
      { header: 'Namespace', value: e => e.metadata?.namespace || '' },
      { header: 'Age', value: e => age(e.metadata?.creationTimestamp || e.lastTimestamp) },
    ],
    actions: ['detail'],
    canCreate: false,
  },
  {
    key: 'customresourcedefinitions', kind: 'CustomResourceDefinition', apiVersion: 'apiextensions.k8s.io/v1',
    namespaced: false, group: 'cluster', icon: 'Component', label: 'CRDs',
    listPath: () => apisListPath('apiextensions.k8s.io', 'v1', 'customresourcedefinitions', ''),
    watchPath: (_ns, rv) => apisWatchPath('apiextensions.k8s.io', 'v1', 'customresourcedefinitions', '', rv),
    columns: [
      { header: 'Name', value: c => c.metadata?.name || '' },
      { header: 'Group', value: c => c.spec?.group || '', searchable: true },
      { header: 'Kind', value: c => c.spec?.names?.kind || '', searchable: true },
      { header: 'Version', value: c => (c.spec?.versions || []).map((v: any) => v.name).join(',') || c.spec?.version || '' },
      { header: 'Scope', value: c => c.spec?.scope || '' },
      { header: 'Age', value: c => age(c.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Group', value: c => c.spec?.group || '' },
        { label: 'Kind', value: c => c.spec?.names?.kind || '' },
        { label: 'Plural', value: c => c.spec?.names?.plural || '' },
        { label: 'Scope', value: c => c.spec?.scope || '' },
        { label: 'Versions', value: c => (c.spec?.versions || []).map((v: any) => `${v.name}${v.served ? ' (served)' : ''}${v.storage ? ' (storage)' : ''}`).join('\n') || '—' },
      ]},
    ),
  },
]
