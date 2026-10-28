# 组件拆分映射表

> **用途**：当上游更新 6 大组件原文件时，本表帮助快速定位上游改动对应到哪个子组件/composable，加速 merge 冲突解决。
> **更新日期**：2026-10-28
> **拆分提交**：`5b5ed8cf`

## 概览

| 组件 | 上游行数 | 本地行数 | 子组件数 | composables数 | 子目录 |
|------|---------|---------|---------|--------------|--------|
| Sidebar.vue | 2165 | 550 | 4 | 3 | `sidebar/` |
| ConnectionForm.vue | 2358 | 799 | 4 | 8 | `connection-form/` |
| MonitorTabContent.vue | 2620 | 339 | 10 | 1 | `monitor/` |
| AISidebar.vue | 2624 | 359 | 4 | 1 | `ai-sidebar/` |
| SettingsTab.vue | 3950 | 290 | 12 | 1 | `settings/` |
| BaseTerminal.vue | 2619 | 543 | 3 | 11 | `terminal/` |

---

## 1. Sidebar.vue (2165 → 550)

### 子组件

| 子组件 | 行数 | 对应上游区域 |
|--------|------|-------------|
| `sidebar/ConnectionItem.vue` | 245 | 单个连接条目的模板+右键菜单 |
| `sidebar/ConnectionGroup.vue` | 143 | 连接分组折叠/拖拽 |
| `sidebar/QuickConnectPanel.vue` | 371 | 快速连接面板（输入框+历史） |
| `sidebar/PersonalizationPanel.vue` | 239 | 个性化设置面板（主题/字体） |

### composables

| composable | 行数 | 对应上游区域 |
|-----------|------|-------------|
| `useSidebarDrag.ts` | 61 | 拖拽排序逻辑 |
| `useConnectionTree.ts` | 665 | 连接树计算属性+过滤+搜索 |
| `useGroupActions.ts` | 398 | 分组增删改+拖拽入组 |

### merge 冲突策略
- 上游新增连接类型/右键菜单项 → 改 `ConnectionItem.vue`
- 上游新增侧边栏面板 → 在 `Sidebar.vue` 加 import + template
- 上游改连接树逻辑 → 改 `useConnectionTree.ts`

---

## 2. ConnectionForm.vue (2358 → 799)

### 子组件

| 子组件 | 行数 | 对应上游区域 |
|--------|------|-------------|
| `connection-form/BasicFields.vue` | 471 | 基本字段（名称/主机/端口/类型） |
| `connection-form/AuthFields.vue` | 212 | 认证字段（密码/密钥/agent） |
| `connection-form/AdvancedFields.vue` | 491 | 高级字段（跳板/保持活动/编码） |
| `connection-form/ProxyFields.vue` | 63 | 代理字段 |

### composables

| composable | 行数 | 对应上游区域 |
|-----------|------|-------------|
| `connection-form/formDefaults.ts` | 155 | 表单默认值 |
| `connection-form/useRdpResolution.ts` | 108 | RDP 分辨率计算 |
| `connection-form/useConnectionCategories.ts` | 109 | 连接类型分类 |
| `connection-form/useConnectionFilePickers.ts` | 106 | 密钥/证书文件选择 |
| `connection-form/useK8sContexts.ts` | 116 | K8s context 加载 |
| `connection-form/useShellOptions.ts` | 40 | Shell 选项 |
| `connection-form/useGroupDialog.ts` | 70 | 分组选择对话框 |
| `useFormValidation.ts` | 208 | 表单验证逻辑 |

### merge 冲突策略
- 上游新增连接字段 → 判断属于哪个分组，加到对应 `*Fields.vue`
- 上游改验证逻辑 → 改 `useFormValidation.ts`
- 上游新增连接类型 → 改 `useConnectionCategories.ts` + `formDefaults.ts`

---

## 3. MonitorTabContent.vue (2620 → 339)

### 子组件

| 子组件 | 行数 | 对应上游区域 |
|--------|------|-------------|
| `monitor/MonitorPerformance.vue` | — | CPU/内存/网络性能图表 |
| `monitor/ProcessList.vue` | — | 进程列表 |
| `monitor/PortList.vue` | — | 端口列表 |
| `monitor/DiskList.vue` | — | 磁盘列表 |
| `monitor/NetCardList.vue` | — | 网卡列表 |
| `monitor/ServiceList.vue` | — | 服务列表 |
| `monitor/DeviceList.vue` | — | 设备列表 |
| `monitor/SystemInfoPane.vue` | — | 系统信息 |
| `monitor/HardwareHealth.vue` | — | 硬件健康 |
| `monitor/ProcessDetailDrawer.vue` | — | 进程详情抽屉 |

### composables

| composable | 行数 | 对应上游区域 |
|-----------|------|-------------|
| `useMonitorData.ts` | 502 | 监控数据轮询+格式化 |

### 其他

| 文件 | 行数 | 说明 |
|------|------|------|
| `monitor/monitorTypes.ts` | 275 | 监控数据类型定义 |

### merge 冲突策略
- 上游新增监控指标 → 改对应 `*List.vue` 或新建子组件
- 上游改数据轮询 → 改 `useMonitorData.ts`
- 上游新增监控类型 → 改 `monitorTypes.ts`

---

## 4. AISidebar.vue (2624 → 359)

### 子组件

| 子组件 | 行数 | 对应上游区域 |
|--------|------|-------------|
| `ai-sidebar/AIChatList.vue` | 527 | 聊天消息列表渲染 |
| `ai-sidebar/AIChatInput.vue` | 1711 | 输入框（contenteditable+附件+@提及） |
| `ai-sidebar/AIMessageItem.vue` | 740 | 单条消息渲染（markdown+代码块） |
| `ai-sidebar/AIToolCallItem.vue` | 243 | 工具调用渲染 |

### composables

| composable | 行数 | 对应上游区域 |
|-----------|------|-------------|
| `useAIChat.ts` | 260 | 聊天会话管理+发送+停止 |

### 注意
- `AIChatInput.vue` (1711行) 因 contenteditable DOM 操作与下拉菜单逻辑紧密耦合，未进一步拆分
- `AIMessage.vue` (451行) 也被精简，markdown 渲染逻辑迁至 `AIMessageItem.vue`

### merge 冲突策略
- 上游改 AI 消息渲染 → 改 `AIMessageItem.vue`
- 上游改输入框行为 → 改 `AIChatInput.vue`
- 上游新增 AI 功能 → 改 `useAIChat.ts` 或新建子组件

---

## 5. SettingsTab.vue (3950 → 290)

### 子组件

| 子组件 | 行数 | 对应上游区域 |
|--------|------|-------------|
| `settings/BasicSettings.vue` | — | 基本设置（语言/主题/字体） |
| `settings/TerminalSettings.vue` | — | 终端设置（光标/滚动/编码） |
| `settings/LocalDataSettings.vue` | — | 本地数据管理 |
| `settings/SyncSettings.vue` | — | 云同步设置 |
| `settings/ShortcutSettings.vue` | — | 快捷键设置 |
| `settings/AISettings.vue` | — | AI 设置（模型/API） |
| `settings/SkillsSettings.vue` | — | Skills 管理 |
| `settings/MCPSettings.vue` | — | MCP Server 管理 |
| `settings/ConnectionSettings.vue` | — | 连接默认值 |
| `settings/AboutSettings.vue` | — | 关于页面 |
| `settings/_shared.css` | — | 共享样式 |

### composables

| composable | 行数 | 对应上游区域 |
|-----------|------|-------------|
| `useSettingsForm.ts` | 39 | 设置表单通用逻辑 |

### merge 冲突策略
- 上游新增设置项 → 判断属于哪个分组，加到对应 `*Settings.vue`
- 上游改设置分组 → 改 `SettingsTab.vue` 的 tab 列表
- 上游新增设置页 → 新建 `settings/XxxSettings.vue` + 在 `SettingsTab.vue` 注册

---

## 6. BaseTerminal.vue (2619 → 543)

### 子组件

| 子组件 | 行数 | 对应上游区域 |
|--------|------|-------------|
| `terminal/TerminalSearch.vue` | 229 | 搜索栏 |
| `terminal/TerminalOverlay.vue` | 74 | 覆盖层（加载/连接状态） |
| `terminal/TerminalToolbar.vue` | 120 | 工具栏 |

### composables

| composable | 行数 | 对应上游区域 |
|-----------|------|-------------|
| `useTerminalResize.ts` | 194 | 终端 resize + fit |
| `useTerminalRecorder.ts` | 217 | 终端录制 |
| `useTerminalKeyHandler.ts` | 313 | 键盘输入处理 |
| `useTerminalTouchPan.ts` | 148 | 触摸平移（移动端） |
| `useTerminalZmodem.ts` | 237 | Zmodem 文件传输 |
| `useTerminalThemeApply.ts` | 88 | 主题应用 |
| `useTerminalSessionEvents.ts` | 325 | 会话事件绑定 |
| `useTerminalDataFlow.ts` | 259 | 数据流（onData + session:data） |
| `useTerminalRender.ts` | 108 | 渲染逻辑 |
| `useTerminalHelpers.ts` | 121 | 辅助函数 |
| `useTerminalLifecycle.ts` | 465 | 生命周期（mount/unmount） |

### merge 冲突策略
- 上游改终端输入处理 → 改 `useTerminalKeyHandler.ts`
- 上游改数据流/节流 → 改 `useTerminalDataFlow.ts`
- 上游改 Zmodem → 改 `useTerminalZmodem.ts`
- 上游新增终端 UI 元素 → 改 `BaseTerminal.vue` template 或新建子组件
- **注意**：Ctrl+C/V 智能复制是本地特有设计，上游该文件改动时保留本地实现

---

## merge 冲突解决流程

1. `git merge upstream/main` 产生冲突
2. 查看冲突文件名，对照本表找到对应的子组件/composable
3. 上游改动通常是增量（新功能/bugfix），在子组件中找到对应位置手动合并
4. 验证：`vue-tsc --noEmit` + `vite build`
5. 如果上游改动涉及新区域（本表未覆盖），评估是否需要新建子组件

## PR 贡献说明模板

每个 PR 的说明应包含：
```
## 动机
{组件名} 已达 {行数} 行，难以维护和协作开发。

## 方案
纯重构：拆分为 {N} 个子组件 + {M} 个 composables，不改任何功能行为。

## 行数对比
- 原文件：{原行数} → {新行数} 行
- 子组件：{列表}
- composables：{列表}

## 验证
- vue-tsc：0 错误
- vite build：通过
- Mac 端 UI 验证：通过

## 不影响后续开发
子组件命名清晰，新增功能可直接添加到对应子组件。
```