// RBAC 资源描述器：serviceaccounts, roles, rolebindings, clusterroles, clusterrolebindings。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, rbacRules, rbacSubjects, withMeta, coreListPath, coreWatchPath, apisListPath, apisWatchPath } from './k8sResourceHelpers'

export const RBAC_DESCRIPTORS: ResourceDescriptor[] = [
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
    createTemplate: ns => `apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-serviceaccount
  namespace: ${ns}
  labels:
    app: my-app
# Do not auto-mount API credentials by default (safer); set true when API access is needed
automountServiceAccountToken: false
# Credentials for pulling images from private registries (create a docker-registry Secret first)
# imagePullSecrets:
#   - name: my-registry-secret
`,
    detailSections: withMeta(
      { label: 'Detail', fields: [
        { label: 'Secrets', value: s => (s.secrets || []).map((x: any) => x.name).join('\n') || '—' },
        { label: 'Image Pull Secrets', value: s => (s.imagePullSecrets || []).map((x: any) => x.name).join('\n') || '—' },
      ]},
    ),
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
    createTemplate: ns => `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: my-role
  namespace: ${ns}
rules:
  # read-only access to core resources
  - apiGroups: [""]
    resources: ["pods", "pods/log", "services", "endpoints"]
    verbs: ["get", "list", "watch"]
  # read-only access to workloads
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch"]
  # read/write on ConfigMaps, restricted to a specific name
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["my-configmap"]
    verbs: ["get", "list", "watch", "update", "patch"]
`,
    detailSections: withMeta(
      { label: 'Rules', fields: [ { label: 'Rules', value: rbacRules } ] },
    ),
  },
  {
    key: 'rolebindings', kind: 'RoleBinding', apiVersion: 'rbac.authorization.k8s.io/v1',
    namespaced: true, group: 'rbac', icon: 'Lock', label: 'RoleBindings',
    listPath: ns => apisListPath('rbac.authorization.k8s.io', 'v1', 'rolebindings', ns),
    watchPath: (ns, rv) => apisWatchPath('rbac.authorization.k8s.io', 'v1', 'rolebindings', ns, rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'Namespace', value: r => r.metadata?.namespace || '' },
      { header: 'Role', value: r => r.roleRef?.name || '', searchable: true },
      { header: 'Kind', value: r => r.roleRef?.kind || '' },
      { header: 'Subjects', value: r => (r.subjects || []).map((s: any) => s.name).join(',') || '—', width: 200, searchable: true },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    createTemplate: ns => `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: my-rolebinding
  namespace: ${ns}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: my-role
subjects:
  # bind to a ServiceAccount (used by pods)
  - kind: ServiceAccount
    name: my-serviceaccount
    namespace: ${ns}
  # bind to a user (requires OIDC/cert-based authentication)
  # - kind: User
  #   name: alice@example.com
  #   apiGroup: rbac.authorization.k8s.io
  # bind to a group
  # - kind: Group
  #   name: my-team
  #   apiGroup: rbac.authorization.k8s.io
`,
    detailSections: withMeta(
      { label: 'Binding', fields: [
        { label: 'Role Ref', value: r => `${r.roleRef?.kind || ''}/${r.roleRef?.name || ''}` },
        { label: 'Subjects', value: rbacSubjects },
      ]},
    ),
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
    createTemplate: () => `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: my-clusterrole
rules:
  # read-only access to cluster-scoped resources
  - apiGroups: [""]
    resources: ["nodes", "namespaces", "persistentvolumes"]
    verbs: ["get", "list", "watch"]
  # read-only access to pods in all namespaces
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  # non-resource paths (/healthz etc.)
  - nonResourceURLs: ["/healthz", "/metrics"]
    verbs: ["get"]
`,
    detailSections: withMeta(
      { label: 'Rules', fields: [ { label: 'Rules', value: rbacRules } ] },
    ),
  },
  {
    key: 'clusterrolebindings', kind: 'ClusterRoleBinding', apiVersion: 'rbac.authorization.k8s.io/v1',
    namespaced: false, group: 'rbac', icon: 'Lock', label: 'ClusterRoleBindings',
    listPath: () => apisListPath('rbac.authorization.k8s.io', 'v1', 'clusterrolebindings', ''),
    watchPath: (_ns, rv) => apisWatchPath('rbac.authorization.k8s.io', 'v1', 'clusterrolebindings', '', rv),
    columns: [
      { header: 'Name', value: r => r.metadata?.name || '' },
      { header: 'ClusterRole', value: r => r.roleRef?.name || '', searchable: true },
      { header: 'Subject-Kind', value: r => Array.from(new Set((r.subjects || []).map((s: any) => s.kind))).join(',') || '—' },
      { header: 'Subjects', value: r => (r.subjects || []).map((s: any) => s.name).join(',') || '—', width: 240, searchable: true },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    createTemplate: () => `apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: my-clusterrolebinding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: my-clusterrole
subjects:
  # bind to a ServiceAccount in a specific namespace
  - kind: ServiceAccount
    name: my-serviceaccount
    namespace: default
  # bind to a group (e.g. grant access to the whole ops team)
  # - kind: Group
  #   name: ops-team
  #   apiGroup: rbac.authorization.k8s.io
`,
    detailSections: withMeta(
      { label: 'Binding', fields: [
        { label: 'Role Ref', value: r => `${r.roleRef?.kind || ''}/${r.roleRef?.name || ''}` },
        { label: 'Subjects', value: rbacSubjects },
      ]},
    ),
  },
]
