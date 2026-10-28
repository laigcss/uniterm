// ResourceDescriptor 表驱动 K8sTree + K8sResourceList。
// 每种资源在这里加一条，不写新组件。
//
// 本文件为 barrel re-export，实际实现已按职责拆分到：
//   k8sResourceTypes.ts        — 类型定义
//   k8sResourceHelpers.ts      — helper 函数 + 路径 helper
//   k8sResourceDescriptors.ts  — RESOURCES 合并 + getResource
//   k8sWorkloadDescriptors.ts  — pods/deployments/statefulsets/daemonsets
//   k8sBatchDescriptors.ts     — jobs/cronjobs/replicasets/HPA
//   k8sNetworkDescriptors.ts   — services/ingresses/gateways/routes/networkpolicies/endpoints
//   k8sConfigDescriptors.ts    — configmaps/secrets/quotas/limitranges
//   k8sStorageDescriptors.ts   — PVC/PV/storageclasses
//   k8sClusterDescriptors.ts   — nodes/namespaces/events/CRD
//   k8sRbacDescriptors.ts      — serviceaccounts/roles/bindings

export * from './k8sResourceTypes'
export * from './k8sResourceHelpers'
export * from './k8sResourceDescriptors'
