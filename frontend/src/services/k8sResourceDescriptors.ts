// 合并各 group 的资源描述器，从 k8sResources.ts 拆分。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { WORKLOAD_DESCRIPTORS } from './k8sWorkloadDescriptors'
import { BATCH_DESCRIPTORS } from './k8sBatchDescriptors'
import { NETWORK_DESCRIPTORS } from './k8sNetworkDescriptors'
import { CONFIG_DESCRIPTORS } from './k8sConfigDescriptors'
import { STORAGE_DESCRIPTORS } from './k8sStorageDescriptors'
import { CLUSTER_DESCRIPTORS } from './k8sClusterDescriptors'
import { RBAC_DESCRIPTORS } from './k8sRbacDescriptors'

export const RESOURCES: ResourceDescriptor[] = [
  ...WORKLOAD_DESCRIPTORS,
  ...BATCH_DESCRIPTORS,
  ...NETWORK_DESCRIPTORS,
  ...CONFIG_DESCRIPTORS,
  ...STORAGE_DESCRIPTORS,
  ...CLUSTER_DESCRIPTORS,
  ...RBAC_DESCRIPTORS,
]

export function getResource(key: string): ResourceDescriptor | undefined {
  return RESOURCES.find(r => r.key === key)
}