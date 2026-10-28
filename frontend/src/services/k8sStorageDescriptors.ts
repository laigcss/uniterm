// Storage 资源描述器：persistentvolumeclaims, persistentvolumes, storageclasses。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, kv, withMeta, coreListPath, coreWatchPath, apisListPath, apisWatchPath } from './k8sResourceHelpers'

export const STORAGE_DESCRIPTORS: ResourceDescriptor[] = [
  {
    key: 'persistentvolumeclaims', kind: 'PersistentVolumeClaim', apiVersion: 'v1',
    namespaced: true, group: 'storage', icon: 'HardDrive', label: 'PVCs',
    listPath: ns => coreListPath('persistentvolumeclaims', ns),
    watchPath: (ns, rv) => coreWatchPath('persistentvolumeclaims', ns, rv),
    columns: [
      { header: 'Name', value: p => p.metadata?.name || '' },
      { header: 'Namespace', value: p => p.metadata?.namespace || '' },
      { header: 'Status', value: p => p.status?.phase || '', filterable: { type: 'enum' } },
      { header: 'Volume', value: p => p.spec?.volumeName || '', searchable: true },
      { header: 'Capacity', value: p => p.status?.capacity?.storage || '' },
      { header: 'Storage Class', value: p => p.spec?.storageClassName || '', searchable: true },
      { header: 'Age', value: p => age(p.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
    rowTone: p => (p.status?.phase === 'Bound' ? '' : 'warn'),
    createTemplate: ns => `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: ${ns}
  labels:
    app: my-app
spec:
  accessModes:
    - ReadWriteOnce
  # Omit storageClassName to use the cluster default StorageClass;
  # set it to the matching value when binding to a manually created PV (storageClassName: manual)
  storageClassName: ""
  volumeMode: Filesystem
  resources:
    requests:
      storage: 5Gi
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Access Modes', value: p => (p.spec?.accessModes || []).join(',') },
        { label: 'Storage Class', value: p => p.spec?.storageClassName || '' },
        { label: 'Volume Name', value: p => p.spec?.volumeName || '' },
        { label: 'Volume Mode', value: p => p.spec?.volumeMode || '' },
        { label: 'Requested', value: p => p.spec?.resources?.requests?.storage || '' },
      ]},
      { label: 'Status', fields: [
        { label: 'Phase', value: p => p.status?.phase || '' },
        { label: 'Capacity', value: p => p.status?.capacity?.storage || '' },
      ]},
    ),
  },
  {
    key: 'persistentvolumes', kind: 'PersistentVolume', apiVersion: 'v1',
    namespaced: false, group: 'storage', icon: 'Database', label: 'PVs',
    listPath: () => coreListPath('persistentvolumes', ''),
    watchPath: (_ns, rv) => coreWatchPath('persistentvolumes', '', rv),
    columns: [
      { header: 'Name', value: p => p.metadata?.name || '' },
      { header: 'Capacity', value: p => p.spec?.capacity?.storage || '' },
      { header: 'Access Modes', value: p => (p.spec?.accessModes || []).join(',') },
      { header: 'Reclaim Policy', value: p => p.spec?.persistentVolumeReclaimPolicy || '' },
      { header: 'Status', value: p => p.status?.phase || '', filterable: { type: 'enum' } },
      { header: 'Claim', value: p => p.spec?.claimRef ? `${p.spec.claimRef.namespace}/${p.spec.claimRef.name}` : '', searchable: true },
      { header: 'Storage Class', value: p => p.spec?.storageClassName || '', searchable: true },
      { header: 'Reason', value: p => p.status?.reason || '' },
      { header: 'Age', value: p => age(p.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
    rowTone: p => (p.status?.phase === 'Bound' || p.status?.phase === 'Available' ? '' : 'warn'),
    createTemplate: () => `apiVersion: v1
kind: PersistentVolume
metadata:
  name: my-pv
  labels:
    app: my-app
spec:
  capacity:
    storage: 5Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  volumeMode: Filesystem
  # hostPath is for single-node testing only; use nfs / csi in production
  hostPath:
    path: /mnt/data
    type: DirectoryOrCreate
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Capacity', value: p => p.spec?.capacity?.storage || '' },
        { label: 'Access Modes', value: p => (p.spec?.accessModes || []).join(',') },
        { label: 'Reclaim Policy', value: p => p.spec?.persistentVolumeReclaimPolicy || '' },
        { label: 'Storage Class', value: p => p.spec?.storageClassName || '' },
        { label: 'Volume Mode', value: p => p.spec?.volumeMode || '' },
        { label: 'Source', value: p => Object.keys(p.spec || {}).find(k => !['capacity','accessModes','persistentVolumeReclaimPolicy','storageClassName','volumeMode','claimRef','mountOptions','nodeAffinity'].includes(k)) || '—' },
      ]},
      { label: 'Status', fields: [
        { label: 'Phase', value: p => p.status?.phase || '' },
        { label: 'Claim', value: p => p.spec?.claimRef ? `${p.spec.claimRef.namespace}/${p.spec.claimRef.name}` : '—' },
        { label: 'Reason', value: p => p.status?.reason || '—' },
      ]},
    ),
  },
  {
    key: 'storageclasses', kind: 'StorageClass', apiVersion: 'storage.k8s.io/v1',
    namespaced: false, group: 'storage', icon: 'Package2', label: 'StorageClasses',
    listPath: () => apisListPath('storage.k8s.io', 'v1', 'storageclasses', ''),
    watchPath: (_ns, rv) => apisWatchPath('storage.k8s.io', 'v1', 'storageclasses', '', rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Provisioner', value: s => s.provisioner || '', searchable: true },
      { header: 'Reclaim Policy', value: s => s.reclaimPolicy || '' },
      { header: 'Volume Binding Mode', value: s => s.volumeBindingMode || '' },
      { header: 'Allow Expansion', value: s => s.allowVolumeExpansion ? 'true' : 'false' },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    createTemplate: () => `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: my-storageclass
  # Optional: make this the cluster default StorageClass
  # annotations:
  #   storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
mountOptions:
  - rw
  - noatime
# provisioner-specific parameters, e.g. for the NFS CSI driver:
# parameters:
#   server: 192.168.1.100
#   share: /export/data
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Provisioner', value: s => s.provisioner || '' },
        { label: 'Reclaim Policy', value: s => s.reclaimPolicy || '' },
        { label: 'Volume Binding Mode', value: s => s.volumeBindingMode || '' },
        { label: 'Allow Expansion', value: s => s.allowVolumeExpansion ? 'true' : 'false' },
        { label: 'Parameters', value: s => kv(s.parameters) },
      ]},
    ),
  },
]
