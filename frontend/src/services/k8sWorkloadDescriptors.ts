// Workloads 资源描述器：pods, deployments, statefulsets, daemonsets。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, podReady, podRestarts, podResourceTotals, podStatus, podTone, replicaTone, selectorText, withMeta, coreListPath, coreWatchPath, apisListPath, apisWatchPath } from './k8sResourceHelpers'
import { formatCpu, formatMemory, percent } from './k8sQuantity'

export const WORKLOAD_DESCRIPTORS: ResourceDescriptor[] = [
  {
    key: 'pods', kind: 'Pod', apiVersion: 'v1',
    namespaced: true, group: 'workloads', icon: 'Box', label: 'Pods',
    listPath: ns => coreListPath('pods', ns),
    watchPath: (ns, rv) => coreWatchPath('pods', ns, rv),
    columns: [
      { header: 'Name', value: p => p.metadata?.name || '' },
      { header: 'Namespace', value: p => p.metadata?.namespace || '', filterable: { type: 'enum' } },
      { header: 'Ready', value: podReady, filterable: { type: 'enum' } },
      { header: 'Status', value: podStatus, filterable: { type: 'enum' }, searchable: true },
      { header: 'Restarts', value: podRestarts },
      { header: 'CPU', value: (_p, u) => u ? formatCpu(u.cpu) : '—', width: 80, sortValue: (_p, u) => u?.cpu ?? -1 },
      { header: 'MEM', value: (_p, u) => u ? formatMemory(u.mem) : '—', width: 80, sortValue: (_p, u) => u?.mem ?? -1 },
      { header: '%CPU/R', value: (p, u) => u ? percent(u.cpu, podResourceTotals(p).cpuReq) : '—', width: 80 },
      { header: '%CPU/L', value: (p, u) => u ? percent(u.cpu, podResourceTotals(p).cpuLim) : '—', width: 80 },
      { header: '%MEM/R', value: (p, u) => u ? percent(u.mem, podResourceTotals(p).memReq) : '—', width: 80 },
      { header: '%MEM/L', value: (p, u) => u ? percent(u.mem, podResourceTotals(p).memLim) : '—', width: 80 },
      { header: 'IP', value: p => p.status?.podIP || '', width: 120, searchable: true },
      { header: 'Node', value: p => p.spec?.nodeName || '', filterable: { type: 'enum' }, searchable: true },
      { header: 'Age', value: p => age(p.metadata?.creationTimestamp) },
    ],
    actions: ['terminal', 'files', 'logs', 'delete'],
    canCreate: true,
    createTemplate: ns => `apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  namespace: ${ns}
  labels:
    app: my-app
spec:
  restartPolicy: Always
  terminationGracePeriodSeconds: 30
  # Optional: pin the pod to nodes with matching labels
  # nodeSelector:
  #   kubernetes.io/os: linux
  containers:
    - name: main
      image: nginx:1.27
      imagePullPolicy: IfNotPresent
      ports:
        - name: http
          containerPort: 80
          protocol: TCP
      env:
        - name: TZ
          value: Asia/Shanghai
        - name: POD_IP
          valueFrom:
            fieldRef:
              fieldPath: status.podIP
      resources:
        requests:
          cpu: 100m
          memory: 128Mi
        limits:
          cpu: 500m
          memory: 512Mi
      readinessProbe:
        httpGet:
          path: /
          port: http
        initialDelaySeconds: 5
        periodSeconds: 10
      livenessProbe:
        httpGet:
          path: /
          port: http
        initialDelaySeconds: 15
        periodSeconds: 20
      volumeMounts:
        - name: data
          mountPath: /usr/share/nginx/html
  # Sidecar container example (keep if needed)
  # - name: sidecar
  #   image: busybox:1.36
  #   command: ["sh", "-c", "while true; do date; sleep 30; done"]
  #   resources:
  #     requests:
  #       cpu: 10m
  #       memory: 16Mi
  volumes:
    - name: data
      emptyDir: {}
      # To use a PVC instead, replace emptyDir with:
      # persistentVolumeClaim:
      #   claimName: my-pvc
`,
    metrics: 'pod',
    rowTone: podTone,
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
    rowTone: d => replicaTone(d.status?.readyReplicas || 0, d.spec?.replicas ?? 0),
    createTemplate: ns => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
  namespace: ${ns}
  labels:
    app: my-app
    app.kubernetes.io/name: my-app
    app.kubernetes.io/component: backend
  annotations:
    kubernetes.io/change-cause: initial deployment
spec:
  replicas: 2
  revisionHistoryLimit: 10
  progressDeadlineSeconds: 600
  minReadySeconds: 5
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: app
          image: nginx:1.27
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
          env:
            - name: TZ
              value: Asia/Shanghai
            - name: LOG_LEVEL
              value: info
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Replicas', value: d => String(d.spec?.replicas ?? 0) },
        { label: 'Strategy', value: d => d.spec?.strategy?.type || '' },
        { label: 'Selector', value: selectorText },
        { label: 'Min Ready Seconds', value: d => String(d.spec?.minReadySeconds ?? 0) },
      ]},
      { label: 'Status', fields: [
        { label: 'Ready', value: d => `${d.status?.readyReplicas || 0}/${d.spec?.replicas ?? 0}` },
        { label: 'Updated', value: d => String(d.status?.updatedReplicas || 0) },
        { label: 'Available', value: d => String(d.status?.availableReplicas || 0) },
        { label: 'Unavailable', value: d => String(d.status?.unavailableReplicas || 0) },
        { label: 'Conditions', value: d => (d.status?.conditions || []).map((c: any) => `${c.type}=${c.status}`).join('\n') || '—' },
      ]},
    ),
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
      { header: 'Service', value: s => s.spec?.serviceName || '' },
      { header: 'Age', value: s => age(s.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'restart', 'scale', 'delete'],
    canCreate: true,
    rowTone: s => replicaTone(s.status?.readyReplicas || 0, s.spec?.replicas ?? 0),
    createTemplate: ns => `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-statefulset
  namespace: ${ns}
  labels:
    app: my-app
spec:
  serviceName: my-statefulset
  replicas: 3
  podManagementPolicy: OrderedReady
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: app
          image: nginx:1.27
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 80
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ""
        volumeMode: Filesystem
        resources:
          requests:
            storage: 1Gi
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Replicas', value: s => String(s.spec?.replicas ?? 0) },
        { label: 'Service Name', value: s => s.spec?.serviceName || '' },
        { label: 'Update Strategy', value: s => s.spec?.updateStrategy?.type || '' },
        { label: 'Pod Mgmt Policy', value: s => s.spec?.podManagementPolicy || '' },
        { label: 'Selector', value: selectorText },
      ]},
      { label: 'Status', fields: [
        { label: 'Ready', value: s => `${s.status?.readyReplicas || 0}/${s.spec?.replicas ?? 0}` },
        { label: 'Current', value: s => String(s.status?.currentReplicas || 0) },
        { label: 'Updated', value: s => String(s.status?.updatedReplicas || 0) },
      ]},
    ),
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
      { header: 'Up-to-date', value: d => d.status?.updatedNumberScheduled || 0 },
      { header: 'Available', value: d => d.status?.numberAvailable || 0 },
      { header: 'Age', value: d => age(d.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'restart', 'delete'],
    canCreate: true,
    rowTone: d => replicaTone(d.status?.numberReady || 0, d.status?.desiredNumberScheduled || 0),
    createTemplate: ns => `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-daemonset
  namespace: ${ns}
  labels:
    app: my-app
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      hostNetwork: false
      tolerations:
        - key: node-role.kubernetes.io/control-plane
          operator: Exists
          effect: NoSchedule
      containers:
        - name: app
          image: nginx:1.27
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 80
              hostPort: 8080
              protocol: TCP
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Update Strategy', value: d => d.spec?.updateStrategy?.type || '' },
        { label: 'Selector', value: selectorText },
      ]},
      { label: 'Status', fields: [
        { label: 'Desired', value: d => String(d.status?.desiredNumberScheduled || 0) },
        { label: 'Current', value: d => String(d.status?.currentNumberScheduled || 0) },
        { label: 'Ready', value: d => String(d.status?.numberReady || 0) },
        { label: 'Up-to-date', value: d => String(d.status?.updatedNumberScheduled || 0) },
        { label: 'Available', value: d => String(d.status?.numberAvailable || 0) },
        { label: 'Misscheduled', value: d => String(d.status?.numberMisscheduled || 0) },
      ]},
    ),
  },
]
