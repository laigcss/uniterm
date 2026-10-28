// Network 资源描述器：services, ingresses, gateways, httproutes, grpcroutes, networkpolicies, endpoints。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, servicePorts, kv, npPorts, npBlocks, endpointsText, withMeta, coreListPath, coreWatchPath, apisListPath, apisWatchPath } from './k8sResourceHelpers'

export const NETWORK_DESCRIPTORS: ResourceDescriptor[] = [
  {
    key: 'services', kind: 'Service', apiVersion: 'v1',
    namespaced: true, group: 'network', icon: 'Network', label: 'Services',
    listPath: ns => coreListPath('services', ns),
    watchPath: (ns, rv) => coreWatchPath('services', ns, rv),
    columns: [
      { header: 'Name', value: s => s.metadata?.name || '' },
      { header: 'Namespace', value: s => s.metadata?.namespace || '' },
      { header: 'Type', value: s => s.spec?.type || '', filterable: { type: 'enum' }, searchable: true },
      { header: 'Cluster-IP', value: s => s.spec?.clusterIP || '', searchable: true },
      { header: 'Ports', value: servicePorts, width: 260, searchable: true },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
    createTemplate: ns => `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: ${ns}
  labels:
    app: my-app
spec:
  type: ClusterIP
  sessionAffinity: None
  selector:
    app: my-app
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
    # NodePort example (takes effect after changing type to NodePort):
    # - name: https
    #   port: 443
    #   targetPort: 8443
    #   nodePort: 30443
    #   protocol: TCP
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Type', value: s => s.spec?.type || '' },
        { label: 'Cluster IP', value: s => s.spec?.clusterIP || '' },
        { label: 'External IPs', value: s => (s.spec?.externalIPs || []).join(',') || '—' },
        { label: 'Session Affinity', value: s => s.spec?.sessionAffinity || '' },
        { label: 'Selector', value: s => kv(s.spec?.selector) },
        { label: 'Ports', value: s => (s.spec?.ports || []).map((p: any) => `${p.name ? p.name + ' ' : ''}${p.port}→${p.targetPort}/${p.protocol || 'TCP'}${p.nodePort ? ' (node ' + p.nodePort + ')' : ''}`).join('\n') || '—' },
      ]},
      { label: 'Status', fields: [
        { label: 'LoadBalancer', value: s => (s.status?.loadBalancer?.ingress || []).map((g: any) => g.ip || g.hostname).join(',') || '—' },
      ]},
    ),
  },
  {
    key: 'ingresses', kind: 'Ingress', apiVersion: 'networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'Globe', label: 'Ingresses',
    listPath: ns => apisListPath('networking.k8s.io', 'v1', 'ingresses', ns),
    watchPath: (ns, rv) => apisWatchPath('networking.k8s.io', 'v1', 'ingresses', ns, rv),
    columns: [
      { header: 'Name', value: i => i.metadata?.name || '' },
      { header: 'Namespace', value: i => i.metadata?.namespace || '' },
      { header: 'Class', value: i => i.spec?.ingressClassName || '', searchable: true },
      { header: 'Hosts', value: i => (i.spec?.rules || []).map((r: any) => r.host).filter(Boolean).join(',') || '*', searchable: true },
      { header: 'Address', value: i => (i.status?.loadBalancer?.ingress || []).map((g: any) => g.ip || g.hostname).filter(Boolean).join(','), searchable: true },
      { header: 'Ports', value: i => (i.spec?.tls?.length ? '80,443' : '80') },
      { header: 'Age', value: i => age(i.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    canCreate: true,
    createTemplate: ns => `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: ${ns}
  labels:
    app: my-app
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    # cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - example.local
      secretName: my-ingress-tls
  rules:
    - host: example.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-service
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: my-api-service
                port:
                  number: 8080
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Class', value: i => i.spec?.ingressClassName || '' },
        { label: 'TLS', value: i => (i.spec?.tls || []).map((t: any) => (t.hosts || []).join(',') + (t.secretName ? ` → ${t.secretName}` : '')).join('\n') || '—' },
        { label: 'Rules', value: i => (i.spec?.rules || []).flatMap((r: any) =>
            (r.http?.paths || []).map((p: any) => `${r.host || '*'}${p.path || '/'} → ${p.backend?.service?.name || ''}:${p.backend?.service?.port?.number || p.backend?.service?.port?.name || ''}`)
          ).join('\n') || '—' },
      ]},
      { label: 'Status', fields: [
        { label: 'Address', value: i => (i.status?.loadBalancer?.ingress || []).map((g: any) => g.ip || g.hostname).join(',') || '—' },
      ]},
    ),
  },
  // ── Gateway API（gateway.networking.k8s.io；GatewayClass 属集群级基建定义，
  //    不单独列出，需要时从 Cluster → CRDs 查看）──────────────────────
  {
    key: 'gateways', kind: 'Gateway', apiVersion: 'gateway.networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'Waypoints', label: 'Gateways',
    listPath: ns => apisListPath('gateway.networking.k8s.io', 'v1', 'gateways', ns),
    watchPath: (ns, rv) => apisWatchPath('gateway.networking.k8s.io', 'v1', 'gateways', ns, rv),
    columns: [
      { header: 'Name', value: i => i.metadata?.name || '' },
      { header: 'Namespace', value: i => i.metadata?.namespace || '' },
      { header: 'Class', value: i => i.spec?.gatewayClassName || '', searchable: true },
      { header: 'Addresses', value: i => (i.status?.addresses || []).map((a: any) => a.value).filter(Boolean).join(','), searchable: true },
      { header: 'Ports', value: i => (i.spec?.listeners || []).map((l: any) => l.port).filter(Boolean).join(',') },
      { header: 'Age', value: i => age(i.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
    // 未 Programmed（如没有可用 controller/地址）整行告警
    rowTone: i => ((i.status?.conditions || []).find((c: any) => c.type === 'Programmed')?.status === 'False' ? 'warn' : ''),
  },
  {
    key: 'httproutes', kind: 'HTTPRoute', apiVersion: 'gateway.networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'Route', label: 'HTTPRoutes',
    listPath: ns => apisListPath('gateway.networking.k8s.io', 'v1', 'httproutes', ns),
    watchPath: (ns, rv) => apisWatchPath('gateway.networking.k8s.io', 'v1', 'httproutes', ns, rv),
    columns: [
      { header: 'Name', value: i => i.metadata?.name || '' },
      { header: 'Namespace', value: i => i.metadata?.namespace || '' },
      { header: 'Hostnames', value: i => (i.spec?.hostnames || []).join(','), searchable: true },
      { header: 'ParentRefs', value: i => (i.spec?.parentRefs || []).map((p: any) => p.name).filter(Boolean).join(','), searchable: true },
      { header: 'Age', value: i => age(i.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
  },
  {
    key: 'grpcroutes', kind: 'GRPCRoute', apiVersion: 'gateway.networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'Route', label: 'GRPCRoutes',
    listPath: ns => apisListPath('gateway.networking.k8s.io', 'v1', 'grpcroutes', ns),
    watchPath: (ns, rv) => apisWatchPath('gateway.networking.k8s.io', 'v1', 'grpcroutes', ns, rv),
    columns: [
      { header: 'Name', value: i => i.metadata?.name || '' },
      { header: 'Namespace', value: i => i.metadata?.namespace || '' },
      { header: 'Hostnames', value: i => (i.spec?.hostnames || []).join(','), searchable: true },
      { header: 'ParentRefs', value: i => (i.spec?.parentRefs || []).map((p: any) => p.name).filter(Boolean).join(','), searchable: true },
      { header: 'Age', value: i => age(i.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'],
  },
  {
    key: 'networkpolicies', kind: 'NetworkPolicy', apiVersion: 'networking.k8s.io/v1',
    namespaced: true, group: 'network', icon: 'BrickWallShield', label: 'NetworkPolicies',
    listPath: ns => apisListPath('networking.k8s.io', 'v1', 'networkpolicies', ns),
    watchPath: (ns, rv) => apisWatchPath('networking.k8s.io', 'v1', 'networkpolicies', ns, rv),
    columns: [
      { header: 'Name', value: n => n.metadata?.name || '' },
      { header: 'Namespace', value: n => n.metadata?.namespace || '' },
      { header: 'Ing-Ports', value: n => npPorts(n.spec?.ingress) },
      { header: 'Ing-Block', value: n => npBlocks(n.spec?.ingress, 'from') },
      { header: 'Egr-Ports', value: n => npPorts(n.spec?.egress) },
      { header: 'Egr-Block', value: n => npBlocks(n.spec?.egress, 'to') },
      { header: 'Age', value: n => age(n.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    createTemplate: ns => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: my-networkpolicy
  namespace: ${ns}
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        # pods labeled frontend in the same namespace
        - podSelector:
            matchLabels:
              app: frontend
        # allow a specific CIDR range
        - ipBlock:
            cidr: 10.0.0.0/16
            except:
              - 10.0.5.0/24
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
  egress:
    # allow cluster DNS
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
    - to:
        # allow the mysql pod in the same namespace
        - podSelector:
            matchLabels:
              app: mysql
      ports:
        - protocol: TCP
          port: 3306
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Pod Selector', value: n => kv(n.spec?.podSelector?.matchLabels) },
        { label: 'Policy Types', value: n => (n.spec?.policyTypes || []).join(',') || '—' },
        { label: 'Ingress Ports', value: n => npPorts(n.spec?.ingress) },
        { label: 'Ingress Block', value: n => npBlocks(n.spec?.ingress, 'from') },
        { label: 'Egress Ports', value: n => npPorts(n.spec?.egress) },
        { label: 'Egress Block', value: n => npBlocks(n.spec?.egress, 'to') },
      ]},
    ),
  },
  {
    key: 'endpoints', kind: 'Endpoints', apiVersion: 'v1',
    namespaced: true, group: 'network', icon: 'Cable', label: 'Endpoints',
    listPath: ns => coreListPath('endpoints', ns),
    watchPath: (ns, rv) => coreWatchPath('endpoints', ns, rv),
    columns: [
      { header: 'Name', value: e => e.metadata?.name || '' },
      { header: 'Namespace', value: e => e.metadata?.namespace || '' },
      { header: 'Endpoints', value: endpointsText, width: 320, searchable: true },
      { header: 'Age', value: e => age(e.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: false,
    detailSections: withMeta(
      { label: 'Subsets', fields: [
        { label: 'Endpoints', value: endpointsText },
      ]},
    ),
  },
]
