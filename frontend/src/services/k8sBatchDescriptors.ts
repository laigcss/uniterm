// Batch/autoscaling 资源描述器：jobs, cronjobs, replicasets, HPA。

import type { ResourceDescriptor } from './k8sResourceTypes'
import { age, durationBetween, selectorText, replicaTone, hpaTargets, withMeta, apisListPath, apisWatchPath } from './k8sResourceHelpers'

export const BATCH_DESCRIPTORS: ResourceDescriptor[] = [
  {
    key: 'jobs', kind: 'Job', apiVersion: 'batch/v1',
    namespaced: true, group: 'workloads', icon: 'PlayCircle', label: 'Jobs',
    listPath: ns => apisListPath('batch', 'v1', 'jobs', ns),
    watchPath: (ns, rv) => apisWatchPath('batch', 'v1', 'jobs', ns, rv),
    columns: [
      { header: 'Name', value: j => j.metadata?.name || '' },
      { header: 'Namespace', value: j => j.metadata?.namespace || '' },
      { header: 'Completions', value: j => `${j.status?.succeeded || 0}/${j.spec?.completions ?? 1}` },
      { header: 'Duration', value: j => durationBetween(j.status?.startTime, j.status?.completionTime) },
      { header: 'Age', value: j => age(j.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'delete'],
    canCreate: true,
    rowTone: j => {
      if (j.status?.failed) return 'err'
      const done = (j.status?.succeeded || 0) >= (j.spec?.completions ?? 1)
      return done ? '' : 'warn'
    },
    createTemplate: ns => `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: ${ns}
  labels:
    app: my-job
spec:
  completions: 1
  parallelism: 1
  backoffLimit: 4
  activeDeadlineSeconds: 600
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels:
        app: my-job
    spec:
      restartPolicy: Never
      containers:
        - name: job
          image: busybox:1.36
          imagePullPolicy: IfNotPresent
          command: ["sh", "-c", "echo hello && sleep 5"]
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Completions', value: j => String(j.spec?.completions ?? 1) },
        { label: 'Parallelism', value: j => String(j.spec?.parallelism ?? 1) },
        { label: 'Backoff Limit', value: j => String(j.spec?.backoffLimit ?? '') },
        { label: 'Selector', value: selectorText },
      ]},
      { label: 'Status', fields: [
        { label: 'Active', value: j => String(j.status?.active || 0) },
        { label: 'Succeeded', value: j => String(j.status?.succeeded || 0) },
        { label: 'Failed', value: j => String(j.status?.failed || 0) },
        { label: 'Start Time', value: j => j.status?.startTime || '' },
        { label: 'Completion Time', value: j => j.status?.completionTime || '' },
        { label: 'Duration', value: j => durationBetween(j.status?.startTime, j.status?.completionTime) },
      ]},
    ),
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
    createTemplate: ns => `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: ${ns}
  labels:
    app: my-cronjob
spec:
  schedule: "*/5 * * * *"
  timeZone: Asia/Shanghai
  concurrencyPolicy: Forbid
  suspend: false
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  startingDeadlineSeconds: 300
  jobTemplate:
    metadata:
      labels:
        app: my-cronjob
    spec:
      backoffLimit: 2
      ttlSecondsAfterFinished: 3600
      template:
        metadata:
          labels:
            app: my-cronjob
        spec:
          restartPolicy: OnFailure
          containers:
            - name: job
              image: busybox:1.36
              imagePullPolicy: IfNotPresent
              command: ["sh", "-c", "date; echo hello"]
              resources:
                requests:
                  cpu: 100m
                  memory: 64Mi
                limits:
                  cpu: 500m
                  memory: 256Mi
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Schedule', value: c => c.spec?.schedule || '' },
        { label: 'Suspend', value: c => c.spec?.suspend ? 'true' : 'false' },
        { label: 'Concurrency Policy', value: c => c.spec?.concurrencyPolicy || '' },
        { label: 'Starting Deadline', value: c => String(c.spec?.startingDeadlineSeconds ?? '') },
      ]},
      { label: 'Status', fields: [
        { label: 'Active', value: c => String((c.status?.active || []).length) },
        { label: 'Last Schedule', value: c => c.status?.lastScheduleTime || '' },
        { label: 'Last Successful', value: c => c.status?.lastSuccessfulTime || '' },
      ]},
    ),
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
      { header: 'Current', value: r => r.status?.replicas || 0 },
      { header: 'Ready', value: r => r.status?.readyReplicas || 0 },
      { header: 'Age', value: r => age(r.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'viewPods', 'scale', 'delete'],
    canCreate: true,
    rowTone: r => replicaTone(r.status?.readyReplicas || 0, r.spec?.replicas ?? 0),
    createTemplate: ns => `apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: my-replicaset
  namespace: ${ns}
  labels:
    app: my-app
spec:
  replicas: 2
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
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Replicas', value: r => String(r.spec?.replicas ?? 0) },
        { label: 'Selector', value: selectorText },
      ]},
      { label: 'Status', fields: [
        { label: 'Replicas', value: r => String(r.status?.replicas || 0) },
        { label: 'Ready', value: r => String(r.status?.readyReplicas || 0) },
        { label: 'Available', value: r => String(r.status?.availableReplicas || 0) },
      ]},
    ),
  },
  {
    key: 'horizontalpodautoscalers', kind: 'HorizontalPodAutoscaler', apiVersion: 'autoscaling/v2',
    namespaced: true, group: 'workloads', icon: 'CircleGauge', label: 'HPAs',
    listPath: ns => apisListPath('autoscaling', 'v2', 'horizontalpodautoscalers', ns),
    watchPath: (ns, rv) => apisWatchPath('autoscaling', 'v2', 'horizontalpodautoscalers', ns, rv),
    columns: [
      { header: 'Name', value: h => h.metadata?.name || '' },
      { header: 'Namespace', value: h => h.metadata?.namespace || '' },
      { header: 'Reference', value: h => `${h.spec?.scaleTargetRef?.kind || ''}/${h.spec?.scaleTargetRef?.name || ''}`, searchable: true },
      { header: 'Targets', value: hpaTargets, width: 140 },
      { header: 'MinPods', value: h => h.spec?.minReplicas ?? 0, width: 80 },
      { header: 'MaxPods', value: h => h.spec?.maxReplicas ?? 0, width: 80 },
      { header: 'Replicas', value: h => h.status?.currentReplicas ?? 0, width: 80 },
      { header: 'Age', value: h => age(h.metadata?.creationTimestamp) },
    ],
    actions: ['detail', 'delete'], canCreate: true,
    createTemplate: ns => `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-hpa
  namespace: ${ns}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-deployment
  minReplicas: 2
  maxReplicas: 10
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 80
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
`,
    detailSections: withMeta(
      { label: 'Spec', fields: [
        { label: 'Reference', value: h => `${h.spec?.scaleTargetRef?.kind || ''}/${h.spec?.scaleTargetRef?.name || ''}` },
        { label: 'Min Replicas', value: h => String(h.spec?.minReplicas ?? 0) },
        { label: 'Max Replicas', value: h => String(h.spec?.maxReplicas ?? 0) },
        { label: 'Targets', value: hpaTargets },
      ]},
      { label: 'Status', fields: [
        { label: 'Current Replicas', value: h => String(h.status?.currentReplicas ?? 0) },
        { label: 'Desired Replicas', value: h => String(h.status?.desiredReplicas ?? 0) },
        { label: 'Last Scale', value: h => h.status?.lastScaleTime || '—' },
      ]},
    ),
  },
]
