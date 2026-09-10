/**
 * Tab 注册表 (A1 重构)
 *
 * 把 App.vue 中 16 个 v-else-if 硬编码的 Tab 分发改为注册表驱动：
 *   - 每种 Tab 类型（terminal / sftp / rdp / ...）注册一条 TabDefinition
 *   - TabRenderer.vue 通过 getTabDefinition(tab.type) 查表渲染
 *   - Sidebar 等未来可读 getTabsByCategory() 生成连接菜单
 *
 * 设计说明：
 *   - component 字段存已导入的 Vue 组件对象（保持原有同步加载行为，
 *     避免 lazy import + KeepAlive 组合在首次切换时引入加载闪烁）。
 *     接口同时允许传入 () => Promise<Component> loader，由调用方用
 *     defineAsyncComponent 包裹后注册。
 *   - 注册顺序保存在 #order 数组中，getAllTabDefinitions() 按注册顺序
 *     返回，保证菜单 / i18n 顺序稳定，不依赖 Map 遍历顺序。
 */

import type { Component } from 'vue'
import TerminalTabContent from '../components/TerminalTabContent.vue'
import SettingsTabContent from '../components/SettingsTabContent.vue'
import WorkspaceContent from '../components/WorkspaceContent.vue'
import FileTabContent from '../components/FileTabContent.vue'
import RDPTabContent from '../components/RDPTabContent.vue'
import VNCTabContent from '../components/VNCTabContent.vue'
import SPICETabContent from '../components/SPICETabContent.vue'
import X11DesktopTabContent from '../components/X11DesktopTabContent.vue'
import DBTabContent from '../components/DBTabContent.vue'
import RedisTabContent from '../components/RedisTabContent.vue'
import MongoDBTabContent from '../components/MongoDBTabContent.vue'
import ElasticsearchTabContent from '../components/ElasticsearchTabContent.vue'
import MonitorTabContent from '../components/MonitorTabContent.vue'
import K8sTabContent from '../components/K8sTabContent.vue'
import ContainerTabContent from '../components/ContainerTabContent.vue'
import StartTabContent from '../components/StartTabContent.vue'

/** Tab.type 联合类型（与 types/workspace.ts 的 Tab['type'] 保持一致） */
export type TabType =
  | 'terminal'
  | 'settings'
  | 'workspace'
  | 'sftp'
  | 'rdp'
  | 'vnc'
  | 'spice'
  | 'database'
  | 'mongodb'
  | 'redis'
  | 'elasticsearch'
  | 'monitor'
  | 'start'
  | 'k8s'
  | 'container'
  | 'x11-desktop'

/** Tab 分类，用于 Sidebar 连接菜单分组 */
export type TabCategory =
  | 'terminal'
  | 'file-transfer'
  | 'remote-desktop'
  | 'database'
  | 'container'
  | 'system'
  | 'other'

export interface TabDefinition {
  type: TabType
  /** 渲染组件；内置注册用静态导入，外部可传 defineAsyncComponent(() => import(...)) */
  component: Component
  icon: string
  /** i18n key */
  labelKey: string
  category: TabCategory
  /**
   * 是否需要 panel 派生 props（config / sessionId / host / dbType ...）。
   * TabRenderer 用此标志决定是否查 panelStore 计算 props。
   * terminal / settings / workspace / start / k8s / container 各自的 props
   * 形态不同，由 TabRenderer 内部的 props 工厂按 type 分支处理。
   */
  needsPanelProps?: boolean
}

const registry = new Map<TabType, TabDefinition>()
/** 注册顺序，保证 getAllTabDefinitions() 稳定 */
const order: TabType[] = []

/** 注册一个 Tab 定义。重复注册同 type 会覆盖定义但保留原顺序。 */
export function registerTab(def: TabDefinition): void {
  if (!registry.has(def.type)) order.push(def.type)
  registry.set(def.type, def)
}

/** 取单个 Tab 定义 */
export function getTabDefinition(type: TabType): TabDefinition | undefined {
  return registry.get(type)
}

/** 取所有 Tab 定义（按注册顺序） */
export function getAllTabDefinitions(): TabDefinition[] {
  return order.map((t) => registry.get(t)!).filter(Boolean)
}

/** 按分类过滤 Tab 定义（按注册顺序） */
export function getTabsByCategory(category: TabCategory): TabDefinition[] {
  return getAllTabDefinitions().filter((t) => t.category === category)
}

/** 是否已注册 */
export function hasTabDefinition(type: TabType): boolean {
  return registry.has(type)
}

// ── 内置 Tab 注册（顺序即菜单 / 渲染顺序） ──────────────────────────
// 终端类
registerTab({ type: 'terminal', component: TerminalTabContent, icon: 'terminal', labelKey: 'tab.terminal', category: 'terminal' })
// 系统类
registerTab({ type: 'start', component: StartTabContent, icon: 'home', labelKey: 'tab.start', category: 'system' })
registerTab({ type: 'settings', component: SettingsTabContent, icon: 'settings', labelKey: 'tab.settings', category: 'system' })
registerTab({ type: 'workspace', component: WorkspaceContent, icon: 'split', labelKey: 'tab.workspace', category: 'system' })
// 文件传输类
registerTab({ type: 'sftp', component: FileTabContent, icon: 'folder', labelKey: 'tab.sftp', category: 'file-transfer', needsPanelProps: true })
// 远程桌面类
registerTab({ type: 'rdp', component: RDPTabContent, icon: 'monitor', labelKey: 'tab.rdp', category: 'remote-desktop', needsPanelProps: true })
registerTab({ type: 'vnc', component: VNCTabContent, icon: 'monitor', labelKey: 'tab.vnc', category: 'remote-desktop', needsPanelProps: true })
registerTab({ type: 'spice', component: SPICETabContent, icon: 'monitor', labelKey: 'tab.spice', category: 'remote-desktop', needsPanelProps: true })
registerTab({ type: 'x11-desktop', component: X11DesktopTabContent, icon: 'monitor', labelKey: 'tab.x11Desktop', category: 'remote-desktop', needsPanelProps: true })
// 数据库类
registerTab({ type: 'database', component: DBTabContent, icon: 'database', labelKey: 'tab.database', category: 'database', needsPanelProps: true })
registerTab({ type: 'redis', component: RedisTabContent, icon: 'database', labelKey: 'tab.redis', category: 'database', needsPanelProps: true })
registerTab({ type: 'mongodb', component: MongoDBTabContent, icon: 'database', labelKey: 'tab.mongodb', category: 'database', needsPanelProps: true })
registerTab({ type: 'elasticsearch', component: ElasticsearchTabContent, icon: 'database', labelKey: 'tab.elasticsearch', category: 'database', needsPanelProps: true })
// 监控 / 容器
registerTab({ type: 'monitor', component: MonitorTabContent, icon: 'monitor', labelKey: 'tab.monitor', category: 'other', needsPanelProps: true })
registerTab({ type: 'k8s', component: K8sTabContent, icon: 'container', labelKey: 'tab.k8s', category: 'container' })
registerTab({ type: 'container', component: ContainerTabContent, icon: 'container', labelKey: 'tab.container', category: 'container' })