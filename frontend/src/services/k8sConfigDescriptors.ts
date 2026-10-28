// Config 资源描述器：configmaps, secrets, resourcequotas, limitranges。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, kv, quotaRequest, quotaLimit, withMeta, coreListPath, coreWatchPath } from './k8sResourceHelpers'

export const CONFIG_DESCRIPTORS: ResourceDescriptor[] = [
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
    createTemplate: ns => `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-configmap
  namespace: ${ns}
  labels:
    app: my-app
data:
  # plain key-value pairs
  LOG_LEVEL: info
  MAX_CONNECTIONS: "100"
  # multi-line config file
  app.properties: |
    server.port=8080
    spring.profiles.active=prod
  nginx.conf: |
    server {
      listen 8080;
      location / {
        root /usr/share/nginx/html;
      }
    }
`,
    detailSections: withMeta(
      { label: 'Data', fields: [
        { label: 'Keys', value: c => Object.keys(c.data || {}).join('\n') || '—' },
      ]},
    ),
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
    createTemplate: ns => `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: ${ns}
  labels:
    app: my-app
type: Opaque
# stringData accepts plain text; the apiserver base64-encodes it into data automatically
stringData:
  username: admin
  password: changeme
---
# TLS secret example (for ingress/gateway certificates), requires tls.crt and tls.key:
# apiVersion: v1
# kind: Secret
# metadata:
#   name: my-ingress-tls
#   namespace: ${ns}
# type: kubernetes.io/tls
# stringData:
#   tls.crt: |
#     -----BEGIN CERTIFICATE-----
#     ...
#     -----END CERTIFICATE-----
#   tls.key: |
#     -----BEGIN PRIVATE KEY-----
#     ...
#     -----END PRIVATE KEY-----
`,
    detailSections: withMeta(
      { label: 'Data', fields: [
        { label: 'Type', value: s => s.type || '' },
        { label: 'Keys', value: s => Object.keys(s.data || {}).join('\n') || '—' },
      ]},
    ),
  },
  {
    key: 'resourcequotas', kind: 'ResourceQuota', apiVersion: 'v1',
    namespaced: true, group: 'config', icon: 'File', label: 'ResourceQuotas',
    listPath: ns => coreListPath('resourcequotas', ns),
    watchPath: (ns, rv) => coreWatchPath('resourcequotas', ns, rv),
    columns: [
      { header: 'Name', value: q => q.metadata?.name || '' },
      { header: 'Namespace', value: q => q.metadata?.namespace || '' },
      { header: 'Request', value: quotaRequest, width: 200 },
      { header: 'Limit', value: quotaLimit, width: 200 },
      { header: 'Age', value: q => age(q.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    createTemplate: ns => `apiVersion: v1
kind: ResourceQuota
metadata:
  name: my-quota
  namespace: ${ns}
spec:
  hard:
    # compute resource totals
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    # object counts
    pods: "40"
    services: "10"
    services.nodeports: "5"
    services.loadbalancers: "2"
    persistentvolumeclaims: "20"
    configmaps: "50"
    secrets: "50"
`,
    detailSections: withMeta(
      { label: 'Quota', fields: [
        { label: 'Hard', value: q => kv(q.spec?.hard) },
        { label: 'Used', value: q => kv(q.status?.used) },
      ]},
    ),
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
    createTemplate: ns => `apiVersion: v1
kind: LimitRange
metadata:
  name: my-limitrange
  namespace: ${ns}
spec:
  limits:
    # Container: inject defaults when requests/limits are unset, and enforce min/max
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      max:
        cpu: "2"
        memory: 2Gi
      min:
        cpu: 50m
        memory: 64Mi
      maxLimitRequestRatio:
        cpu: "4"
    # Pod: cap the whole pod
    - type: Pod
      max:
        cpu: "4"
        memory: 4Gi
    # PVC: cap volume size
    - type: PersistentVolumeClaim
      max:
        storage: 100Gi
      min:
        storage: 1Gi
`,
  },
]
