# uniTerm 优化升级技术方案

> 版本：v1（已实施） ｜ 方案日期：2026-09-09 ｜ 实施完成：2026-10-10 ｜ 策略：先方案后实施，允许大重构 ｜ 验证环境：macOS + Go1.26 + Node20+（可 `wails3 dev`）
> 范围：安全加固 + 性能体验 + 架构可维护性 + 功能增强（四方向）

## 概述

本方案基于对 uniterm（Wails v3 + Go + Vue 3，约 5 万行 Go + 6.3 万行前端）的四维分析（后端架构 / 前端架构 / 安全审计 / 功能盘点）产出，共 **17 个优化项**。每项可独立审阅、独立实施、独立验证。项之间有少量依赖（标注于"依赖"字段）。

**工作量图例**：S = 0.5–1 天 ｜ M = 1–2 天 ｜ L = 2–4 天
**破坏性图例**：🔴 高（接口/结构变更，需同步改多处） ｜ 🟡 中（局部行为变更） ｜ 🟢 低（新增/纯优化）

---

## 实施批次总览

建议按批次推进，每批可独立验证、可独立提交。批次内项可并行。

| 批次 | 项 | 方向 | 工作量 | 破坏性 | 依赖 | 实施状态 |
|------|----|------|--------|--------|------|----------|
| **批次 1：安全闭环** | S1 SSH host key TOFU | 安全 | M | 🟡 | — | ✅ 已完成 |
| | S2 AI risk 本地防线 | 安全 | S | 🟢 | — | ✅ 已完成 |
| | S3 baseURL scheme 校验 | 安全 | S | 🟢 | — | ✅ 已完成 |
| | S4 日志脱敏 | 安全 | S | 🟢 | — | ✅ 已完成 |
| **批次 2：体验速赢** | P4 删除 useTerminal.ts 死代码 | 性能 | S | 🟢 | — | ✅ 已完成 |
| | P3 Element Plus 按需引入 | 性能 | S | 🟡 | — | ✅ 已完成 |
| | A5 vue-tsc 类型闸门 + panelStore 修复 | 架构 | S | 🟢 | — | ✅ 已完成 |
| **批次 3：性能核心** | P1 虚拟滚动 | 性能 | M | 🟡 | — | ⚠️ 部分完成 |
| | P2 session:data 批量节流 | 性能 | M | 🟡 | — | ✅ 已完成 |
| **批次 4：架构重构** | A4 SSH 拨号公共函数抽取 | 架构 | S | 🟡 | S1 | ✅ 已完成 |
| | A2 fileTransferSession 接口下沉 | 架构 | M | 🔴 | — | ✅ 已完成 |
| | A3 AI 函数去重 + 工具注册表化 | 架构 | L | 🔴 | — | ✅ 已完成 |
| | A1 App.vue 拆分 + Tab 注册表化 | 架构 | L | 🔴 | A2 | ❌ 未完成 |
| **批次 5：功能增强** | F1 AI Interaction Modes | 功能 | S | 🟢 | — | ✅ 已完成 |
| | F2 批量多主机执行 | 功能 | M | 🟡 | — | ✅ 已完成 |
| | F4 终端录制回放 | 功能 | M | 🟢 | — | ✅ 已完成 |
| | F3 MCP Client | 功能 | L | 🟢 | A3 | ✅ 已完成 |

> 说明：批次 1–2 风险低、收益立竿见影，建议先做；批次 4 是大重构，建议在批次 3 验证稳定后进行；批次 5 的 F3 依赖 A3（工具注册表化后 MCP 工具桥接更自然）。

---

# 方向一：安全加固

## S1. SSH Host Key TOFU（Trust On First Use）校验

**问题**：全部 9 处 SSH 连接使用 `ssh.InsecureIgnoreHostKey()`，完全跳过主机密钥校验，MITM 可拦截连接窃取密码/会话。

**现状证据**：`backend/session/ssh_dial.go`、`ssh_session.go`、`sftp_session.go`、`scp_session.go`、`monitor_session.go`、`tunnel_service.go`、`tunnel_forward.go`、`test_connection.go` 等共 9 处 `InsecureIgnoreHostKey`。

**方案**：
1. 新增 `backend/session/hostkey.go`：
   - `HostKeyCallback` 函数：查 `~/.uniterm/known_hosts`，首次记录 fingerprint（TOFU），变更时返回错误并携带旧/新 fingerprint 供前端弹窗。
   - 提供 `HostKeyCallbackStrict`（变更拒绝）与 `HostKeyCallbackAcceptNew`（首次自动接受，变更弹窗）两种策略，默认 AcceptNew。
   - 存储格式兼容 OpenSSH `known_hosts`（host alg key），便于用户手动管理。
2. 替换全部 9 处 `InsecureIgnoreHostKey()` 为 `HostKeyCallbackAcceptNew(host, port)`。
3. 前端新增"主机密钥变更"确认对话框（复用现有 ConfirmDialog 模式），后端通过 Wails 事件 `session:hostkey-changed` 通知。
4. 设置页加"主机密钥校验策略"选项（AcceptNew / Strict / Off，默认 AcceptNew）。

**破坏性**：🟡 中。首次连接行为变化（记录指纹），变更连接会弹窗（可能影响自动化）。提供 Off 选项保留旧行为。

**风险**：用户已有连接首次升级时会触发"记录"（无感）；若服务器重装密钥会弹窗（正确行为）。需确保 known_hosts 并发写入安全（文件锁）。

**macOS 验证**：
```bash
cd /Users/laigc/Documents/huawei_project/uniTerm/uniterm
wails3 dev
# 连接一台 SSH 服务器（用户提供或用 localhost sshd）
# 1. 首次连接：应无感通过，~/.uniterm/known_hosts 出现记录
# 2. 修改服务器密钥后重连：应弹窗告警
# 3. 设置切到 Strict：变更直接拒绝
```
> ⚠️ 需用户提供一台可登录的 SSH 测试机（或本机开 sshd）才能动态验证变更告警分支。

**工作量**：M（1.5 天）

---

## S2. AI Agent 本地危险命令防线

**问题**：AI Agent 的 risk 评级完全由 LLM 自声明的 `input.risk` 字段决定，`getRisk` 信任模型输出。默认 `confirm_dangerous` 模式下，被 prompt injection 劫持的模型可将 `rm -rf ~` 声明为 `risk:"read"` 免确认执行。缺少独立于模型声明的本地命令模式检测。

**现状证据**：`frontend/src/services/agent.ts` `getRisk()` 信任 `tu.input.risk`；`shouldConfirm(risk)` 按 store.mode 判定；无本地命令模式匹配。

**方案**：
1. 新增 `frontend/src/services/localRisk.ts`：
   - `assessLocalRisk(command: string): 'read' | 'write' | 'dangerous'`，用正则/模式匹配本地判定，**不依赖模型声明**。
   - 危险模式黑名单（强制 dangerous）：`rm -rf`、`rm -fr`、`mkfs`、`dd if=.*of=/dev/`、`chmod -R 777 /`、`curl|sh`/`wget|sh`、`:(){ :|:& };:`（fork bomb）、`> /dev/sda`、`shutdown`/`reboot`/`halt`、`kill -9 1`。
   - 写操作模式（write）：`rm`、`mv`、`chmod`、`chown`、`mkdir`、`touch`、`>` 重定向、`apt`/`yum`/`brew install`、`docker rm`、`kubectl delete`。
   - 反绕过检测：base64 解码后重新评估（`echo ...|base64 -d|sh`）、`sh -c`/`bash -c` 内层评估、变量拼接（`a="rm";$a -rf`）标记为 dangerous。
2. `agent.ts` 中 `getRisk` 改为 `max(modelRisk, localRisk)`（取更严格者），本地防线永不低于模型声明。
3. 设置页加"本地危险命令防线"开关（默认开）+ 可编辑黑名单（高级）。

**破坏性**：🟢 低。纯增强，不改现有接口；默认开启使安全收紧，用户可关。

**风险**：正则误判可能让正常命令多一步确认（可接受，优于漏放）。base64/变量绕过检测不可能穷尽，文档中说明这是"纵深防御"非绝对防线。

**macOS 验证**：
```bash
wails3 dev
# 配置一个 AI 模型（用户提供 API key），打开 AI 侧边栏
# 1. 让 AI 执行 "rm -rf /tmp/test"：即使模型声明 read 也应弹确认
# 2. 让 AI 执行 "echo dGYgcm0gLXJmIH4K|base64 -d|sh"：应识别为 dangerous
# 3. 正常命令 "ls -la"：无感通过
```

**工作量**：S（1 天）

---

## S3. LLM baseURL scheme 校验与密钥保护

**问题**：用户可配置 `http://` baseURL 明文传输 API key；API key 以 Bearer 发往用户配置的任意 URL，被社工填恶意 URL 则 key 泄漏。

**现状证据**：`app_ai.go` `ChatCompletion(apiKey, baseURL, ...)` 无 URL scheme/host 校验；`frontend/src/stores/aiStore.ts` 保存 baseURL 无校验。

**方案**：
1. `aiStore.ts` 保存 baseURL 时校验：非 `https://`（除 `localhost`/`127.0.0.1`）弹警告"明文传输将暴露 API Key，建议 https"。
2. `app_ai.go` `ChatCompletion` 入参校验 baseURL scheme，`http://` 且非本地地址时记录一条 warning 日志（不阻断，尊重用户选择但留痕）。
3. API key 在前端内存中不打印到 console（检查现有 log 是否打 key）。

**破坏性**：🟢 低。仅加校验/警告，不阻断合法本地 http 调试。

**风险**：本地 Ollama 等用 `http://localhost`，需放行 localhost 避免误伤。

**macOS 验证**：配置 `http://example.com/v1` 应弹警告；配置 `http://localhost:11434` 应放行。

**工作量**：S（0.5 天）

---

## S4. 日志脱敏

**问题**：`k8s/rest.go:87` 记录响应体 preview，可能含 Secret 内容；`database_session.go:30` 记录用户名；DSN 构建失败错误可能含密码。

**现状证据**：`backend/log/` 无脱敏机制；`k8s/rest.go`、`database_session.go`、各 `BuildDSN` 错误路径。

**方案**：
1. 新增 `backend/log/redact.go`：`Redact(s string) string` 用正则脱敏（密码/DSN 密码段/token/私钥头尾）。
2. `log` 包写日志前过 `Redact`（可选开关，默认开）。
3. `k8s/rest.go` 对 secret/configmap 类型响应不写 preview 或仅写 `***`。
4. `database/BuildDSN` 错误信息用脱敏后的 DSN（密码段替换为 `***`）。

**破坏性**：🟢 低。

**风险**：脱敏正则可能误伤正常含 "password=" 的非敏感文本（可接受）。

**macOS 验证**：连一个数据库故意输错密码，日志中应看不到明文密码。

**工作量**：S（0.5 天）

---

# 方向二：性能与体验

## P1. 虚拟滚动（大列表/大结果集）

**问题**：`FileList.vue` 用"递增分页"（PAGE_SIZE=200）非真虚拟滚动，超大目录渲染数千 DOM；`DBResultGrid.vue` `:data="rows"` 全量渲染 el-table 无分页/虚拟化，大结果集卡死。

**现状证据**：`frontend/src/components/FileList.vue`、`DBResultGrid.vue`；`package.json` 无虚拟滚动库。

**方案**：
1. 引入 `vue-virtual-scroller`（RecycleScroller，~5KB）或用 Element Plus `el-table-v2`。
2. `FileList.vue`：文件列表改 RecycleScroller，保持现有分批加载逻辑（数据源仍递增，但渲染层虚拟化），每项高度固定或用动态高度（文件名行数）。
3. `DBResultGrid.vue`：改 `el-table-v2`（虚拟滚动表格），结果集默认展示前 1000 行 + "显示更多"，超出提示用户加 LIMIT。
4. 同步检查 `MongoDBCollectionView`、`ElasticsearchIndexView`、`RedisTabContent` 的结果渲染，统一虚拟化。

**破坏性**：🟡 中。组件渲染方式变更，需回归测试排序/选择/右键菜单等交互。

**风险**：虚拟滚动对动态高度/展开行支持较弱，DBResultGrid 若有行展开功能需适配。Element Plus el-table-v2 API 与 el-table 差异较大，样式需重调。

**macOS 验证**：
```bash
wails3 dev
# 1. SFTP 连一台机器，打开 /usr/bin 或 /usr/lib（数千文件），滚动应流畅
# 2. 数据库执行 SELECT * FROM 大表（无 LIMIT），结果集应不卡
```
> ⚠️ 需用户提供一台有大量文件的 SFTP 服务器/大表数据库才能压测。

**工作量**：M（1.5 天）

**实施状态**：⚠️ 部分完成。`FileList.vue` / `DBResultGrid.vue` 已引入 `vue-virtual-scroller` 并虚拟化渲染层；但 `MongoDBCollectionView` / `ElasticsearchIndexView` / `RedisTabContent` 结果视图尚未虚拟化，`DBResultGrid` 因 el-table slot 深度耦合未迁移至 el-table-v2，待后续推进。

---

## P2. session:data 批量节流与 highlight 空闲化

**问题**：每个 `session:data` 事件同步走 stripBlink→ED3→highlight(10+ 组复杂正则)→terminal.write，无批量/节流；8 分屏=8 个 BaseTerminal=8 个监听器，每块广播到所有监听器再过滤 id，高频输出（cat 大文件）CPU 热点 + 事件风暴。

**现状证据**：`BaseTerminal.vue` 1237-1360 行 session:data 处理器（130+ 行同步链）；`useHighlight.ts` 10+ 组正则；Wails Events.On 全局总线。

**方案**：
1. `BaseTerminal.vue` session:data 处理改为**累积 + rAF 批量**：数据块先 push 到 per-session 缓冲队列，`requestAnimationFrame` 内合并写出（一帧内多个块合并后一次 highlight + write）。
2. highlight 移到 `requestIdleCallback`（非关键路径），或对大块（>4KB）降级只做 URL/IPv4 高亮跳过复杂正则。
3. 监听器改为**按 session id 订阅**：Wails 事件名带 id（`session:data:<id>`）或前端用 Map 索引，避免每个块线性扫描所有监听器。需评估 Wails 事件 API 是否支持带 id 事件（若不支持，前端维护 `Map<sessionId, Set<handler>>`，单点订阅分发）。
4. 评估 `sessionStore` 是否需要每个 data 块进 reactive（若仅用于重连回放，可改为非 reactive 缓冲 + 仅在重连时读取）。

**破坏性**：🟡 中。终端输出时序微妙变化（rAF 合并可能让快速输出略有批量化，对交互无感知影响）。

**风险**：rAF 在窗口隐藏时暂停，可能导致后台终端输出不写入——需用 `setTimeout` 兜底或检测可见性。批量合并可能影响 Zmodem 检测（Zmodem 需逐块识别协议头），需对 Zmodem 会话跳过节流。

**macOS 验证**：
```bash
wails3 dev
# 1. SSH 连一台机器，执行 yes | head -100000 或 cat 大文件，观察 CPU 与流畅度
# 2. 开 4-8 个分屏同时输出，对比优化前后 CPU
# 3. Zmodem 传输 rz/sz 应正常（不被节流破坏）
```

**工作量**：M（1.5 天）

---

## P3. Element Plus 按需引入

**问题**：`main.ts` `app.use(ElementPlus)` + 全量 CSS，无按需/tree-shaking，打包偏大（~1MB JS + 340KB CSS）。

**现状证据**：`frontend/src/main.ts` 全量引入。

**方案**：
1. 安装 `unplugin-vue-components` + `unplugin-auto-import`，配置 Element Plus resolver。
2. `main.ts` 移除 `app.use(ElementPlus)` 与全量 CSS import，改按需自动注册 + `@element-plus/auto-import-resolver`。
3. 少数全局指令（如 `ElMessage`/`ElMessageBox`）改为按需 import。
4. `vite.config.ts` 配置 `unplugin-vue-components`。

**破坏性**：🟡 中。组件注册方式变更，需回归全量功能确认无遗漏组件。

**风险**：某些动态组件（如 `<component :is="...">`）若未显式 import 可能不被自动解析，需排查。样式变量覆盖（现有主题）需确认按需 CSS 下仍生效。

**macOS 验证**：
```bash
cd frontend && npm install && cd ..
wails3 dev
# 全量点测各功能（连接/文件/数据库/容器/AI/设置），确认 UI 无缺失
# 对比 build 产物体积：wails3 build 后比较 frontend/dist 体积
```

**工作量**：S（0.5 天）

---

## P4. 删除 useTerminal.ts 死代码

**问题**：`useTerminal.ts` 854 行中 `useTerminal()` composable 无任何组件调用（仅 `getXtermTheme` 被 import），约 800 行死代码。真正的终端实现在 `BaseTerminal.vue` + `terminalManager.ts`。

**现状证据**：grep `useTerminal(` 仅定义处；`terminalManager.ts` 和 `BaseTerminal.vue` import `getXtermTheme`。

**方案**：
1. 将 `useTerminal.ts` 中 `getXtermTheme`（及任何被外部 import 的工具函数）迁移到 `terminalManager.ts` 或新建 `utils/xtermTheme.ts`。
2. 删除 `useTerminal.ts` 其余内容。
3. 更新所有 import `getXtermTheme` 的路径。

**破坏性**：🟢 低。纯删除死代码 + 调整 import 路径。

**风险**：需确认 `useTerminal.ts` 中除 `getXtermTheme` 外无其他被 import 的导出（实施时 grep 确认）。

**macOS 验证**：`wails3 dev` 编译通过 + 终端功能正常。

**工作量**：S（0.5 天）

---

# 方向三：架构可维护性

## A1. App.vue 拆分 + Tab 注册表化

**问题**：`App.vue` 2282 行上帝组件：17 种 Tab 用 v-else-if 链硬编码分发 + 18 个 `onConnectXxx` 近乎逐字重复（仅协议字符串不同）+ 10+ store + 凭据流 + 快捷键 + 右键菜单全在一个文件。新增协议需改 8+ 处。

**现状证据**：`App.vue` 1-2282；`onConnectScp`/`onConnectFtp`/`onConnectSmb`/`onConnectWebdav` 逐字重复；`workspace.ts` PanelType 联合类型 20 种。

**方案**：
1. **Tab 注册表**：新建 `frontend/src/services/tabRegistry.ts`：
   ```ts
   interface TabDefinition {
     type: PanelType
     component: () => Promise<Component>  // 异步组件
     icon: string
     labelKey: string  // i18n key
     onConnect?: (config) => void  // 连接处理
   }
   const registry = new Map<PanelType, TabDefinition>()
   export const registerTab = (def: TabDefinition) => registry.set(def.type, def)
   ```
   每个 Tab 类型在各自模块 `registerTab({...})` 自注册（如 `FileTabContent.module.ts`）。
2. **App.vue 瘦身**：
   - Tab 渲染区改 `<component :is="tabRegistry.get(panel.type).component" />`，删除 17 个 v-else-if。
   - 18 个 `onConnectXxx` 文件传输类合并为 `openFileTransferTab(config, proto, tabKind)` 工厂（5 个函数→1 个，省约 100 行）。
   - 凭据流、快捷键、右键菜单、背景图等逻辑下沉到 composables（`useCredentials.ts`、`useKeybindings.ts`、`useContextMenu.ts`）。
   - 目标：App.vue < 500 行，仅保留顶层布局与组合。
3. **Sidebar.vue** 连接菜单改读注册表（`registry.forEach` 生成菜单项 + emit 统一 `connect` 事件带 type），删除逐协议 emit。
4. **ConnectionForm.vue** 连接类型分类改读注册表元数据。

**破坏性**：🔴 高。App.vue 是应用根组件，拆分影响面广；Tab 注册表是新模式，需迁移全部 17 种 Tab。

**风险**：拆分后需全面回归（每种 Tab 打开/关闭/拖拽/分屏/广播）。异步组件加载需处理 loading 态。注册表顺序（i18n、菜单顺序）需稳定。建议拆分前先补 App.vue 的关键路径快照测试（若有）或手动回归清单。

**依赖**：A2（fileTransferSession 接口下沉后，文件传输 Tab 注册更统一）。

**macOS 验证**：
```bash
wails3 dev
# 回归清单（17 种 Tab 逐一手测）：
# SSH/SFTP/SCP/FTP/SMB/WebDAV/S3/Zmodem/数据库×8/容器×5/K8s/RDP/VNC/SPICE/X11/本地/串口/Mosh/Telnet/RawTCP/WSL
# 每种：打开→操作→分屏→拖拽→关闭→重连
# 快捷键、右键菜单、背景图、凭据解锁全测
```

**工作量**：L（3 天）

**实施状态**：❌ 未完成。App.vue 当前 **1814 行**（目标 < 500 行未达成）。Tab 注册表化、onConnect 工厂化与逻辑下沉 composables 待后续推进；本次仅完成其依赖项 A2（fileTransferSession 接口下沉）。

---

## A2. fileTransferSession 接口下沉到 backend/session 包

**问题**：`fileTransferSession` 契约接口定义在 main 包（使用方），`backend/session` 各实现仅靠注释说明"实现契约"，编译期无法保证一致性。某 session 漏实现方法只在运行时类型断言失败。

**现状证据**：`app_file_transfer.go` 定义 `fileTransferSession` interface；`backend/session/sftp_session.go` 等注释"implements fileTransferSession contract"。

**方案**：
1. 在 `backend/session/` 新建 `file_transfer.go`，定义 `FileTransferSession` interface（ListRemote/Get/Put/MakeDir/Remove/Rename/...）。
2. 各 `*_session.go` 显式声明 `var _ FileTransferSession = (*SFTPSession)(nil)` 等编译期断言。
3. `app_file_transfer.go` 改为 import `session.FileTransferSession`，删除 main 包内的接口定义。
4. 抽取各 session 重复的 `localFSOps`/`transfers`/`taskSeq`/`requireClient`/`getCwd`/`nextTaskID` 到 `fileTransferBase` 嵌入结构（可选，进一步去重）。

**破坏性**：🔴 高。跨包接口迁移，需改 main 包 + session 包多个文件。

**风险**：若某 session 当前实际未实现某方法（靠运行时未触达隐藏），编译期断言会暴露——需补全实现（这是收益也是工作量）。

**工作量**：M（1.5 天）

---

## A3. AI 函数去重 + 工具注册表化

**问题**：
- 后端 `app_ai.go` 三个 `chatCompletionOpenAI`(343行)/`chatCompletionResponses`(285行)/`chatCompletionAnthropic`(189行) 同构（SSE 解析 + block 状态机 + 事件映射），大量重复。
- 前端 `agent.ts` `runAgent` 628 行巨型 if-else 链，每工具一分支；`AVAILABLE_TOOLS` schema / validators / runAgent 分支三处耦合，加工具需改三处（shotgun surgery）。

**现状证据**：`app_ai.go` 三个函数；`agent.ts` 401-1029 runAgent；`llm.ts` AVAILABLE_TOOLS。

**方案**：
1. **后端 SSE 骨架抽取**：新建 `app_ai_stream.go`，提取公共 SSE 解析器 + content block 状态机，三个 provider 仅注册事件映射函数（`mapOpenAIEvent`/`mapAnthropicEvent`/`mapResponsesEvent`）。预计省 400+ 行。
2. **前端工具注册表**：新建 `frontend/src/services/tools/` 目录，每工具一个文件（`executeCommand.ts`、`startCommand.ts`、`captureTerminal.ts`...），每个导出 `{ name, schema, validate, execute }`。`agent.ts` runAgent 改为 `const tool = toolRegistry.get(tu.name); await tool.execute(ctx, tu.input)`。`AVAILABLE_TOOLS` 由注册表自动生成 `Object.values(tools).map(t => t.schema)`。validators 并入各工具文件。
3. 风险确认逻辑也并入工具定义（`tool.confirmPolicy`）。

**破坏性**：🔴 高。AI 执行核心重构，影响 AI Agent 主路径。

**风险**：AI Agent 行为必须逐工具回归（执行/确认/超时/错误）。建议重构前先跑现有 `agent.risk.test.ts`/`agent.toolInput.test.ts`/`terminalAgent.test.ts` 建立基线，重构后全绿 + 手测多轮任务。

**工作量**：L（2.5 天）

---

## A4. SSH 拨号公共函数抽取

**问题**：SSH 拨号配置（`buildAuthMethods` + `ssh.ClientConfig` + `dialSSHTCP`）在 ssh/sftp/scp/monitor/tunnel/test_connection 6+ 处重复。

**现状证据**：grep `InsecureIgnoreHostKey` 9 处；各 session Connect 内重复构造 ClientConfig。

**方案**：
1. `backend/session/ssh_dial.go` 已有 `dialSSHTCP`，扩展为 `dialSSH(host, port, auth, opts) (*ssh.Client, error)`，统一封装 ClientConfig + authMethods + host key callback（接 S1 的 TOFU）+ 超时 + 代理。
2. 各 session Connect 改调 `dialSSH`，删除重复的 ClientConfig 构造。
3. `tunnel_service.go`/`tunnel_forward.go`/`test_connection.go` 同步改用。

**破坏性**：🟡 中。6+ 处调用统一，行为应一致但需回归各连接类型。

**风险**：各 session 对 ClientConfig 有细微差异（如 keepalive、超时），需用 opts 参数保留差异点。

**依赖**：S1（host key callback 统一后再抽更干净）。

**工作量**：S（1 天）

---

## A5. vue-tsc 类型闸门 + panelStore 修复

**问题**：`build` 脚本仅 `vite build` 无 vue-tsc，类型检查从未运行；`panelStore.ts` `spiceCaches` 在 reactive 初始化存在但类型声明缺失，类型错误潜伏；RFB 实例放进 reactive Map 被深层代理。

**现状证据**：`package.json` build 无 vue-tsc；`panelStore.ts` 29-40 类型声明缺 spiceCaches；`vncCaches`/`spiceCaches` 持有 RFB 实例。

**方案**：
1. `package.json` 加 `"typecheck": "vue-tsc --noEmit"`，`build` 改为 `vue-tsc --noEmit && vite build`（或加 `build:check` 单独脚本，避免 dev 时阻塞——建议 CI 用 build:check）。
2. 修复 `panelStore.ts`：补全 `spiceCaches` 类型声明；`vncCaches`/`spiceCaches` 改 `shallowReactive` 或移出 Pinia（用模块级 `Map` + 非响应式，UI 状态另存）。
3. 跑一次 `vue-tsc --noEmit` 修复暴露的其他类型错误（预计 511 处 any 不会报错，但缺失类型/错误赋值会）。

**破坏性**：🟢 低（修复潜伏错误）→ 🟡 中（若 vue-tsc 暴露大量错误需逐一修）。

**风险**：vue-tsc 可能暴露数十个类型错误（项目从未跑过），工作量可能超预期。建议先跑一次看错误量再定范围。

**macOS 验证**：`cd frontend && npx vue-tsc --noEmit` 应 0 error（修复后）。

**工作量**：S（1 天，取决于暴露错误量）

---

# 方向四：功能增强

## F1. AI Interaction Modes（Chat / 只读 / Agent）

**问题**：ROADMAP 规划项，当前有 risk 等级 + 4 种确认模式，但缺总模式切换（Chat 纯对话不执行 / 只读仅执行读命令 / Agent 全自主）。

**现状证据**：`agent.ts` `shouldConfirm` 按 store.mode；无总模式。

**方案**：
1. `aiStore` 加 `interactionMode: 'chat' | 'readonly' | 'agent'`。
2. `runAgent` 中：
   - `chat`：禁用所有执行类工具（execute_command/start_command 等），AI 仅对话。
   - `readonly`：仅允许 read 类工具（capture_terminal/collect_output/execute_command 且 localRisk==read），write/dangerous 一律拒绝。
   - `agent`：走现有 risk + 确认模式。
3. AISidebar 顶部加模式切换 UI（3 个选项 + 当前模式提示）。

**破坏性**：🟢 低。纯新增，不改现有 agent 模式行为。

**风险**：只读模式下 AI 可能反复尝试写命令被拒，需在 system prompt 告知当前模式。

**macOS 验证**：3 种模式各跑一轮 AI 任务，确认权限边界正确。

**工作量**：S（1 天）

---

## F2. 批量多主机执行

**问题**：竞品（WindTerm/Termius）常见能力，uniTerm 缺失。无法对多台主机并发执行同一脚本/命令。

**现状证据**：无相关实现；现有 broadcast 是跨 Tab 输入广播（单会话多 Tab），非多主机。

**方案**：
1. 新增"批量执行"入口（连接管理器多选主机 → 右键"批量执行"）。
2. 复用现有 SSH session：为每台主机创建临时 session，并发执行命令/脚本，结果聚合展示。
3. 新增 `BatchExecuteDialog.vue`：输入命令/选择脚本文件、并发数、超时、失败策略（继续/停止）。
4. 结果面板：每主机一行状态（成功/失败/输出预览），支持查看完整输出。
5. 复用 S2 的 localRisk 对批量命令做确认。

**破坏性**：🟡 中。新增功能模块，不改现有。

**风险**：并发创建大量 session 需限流（连接池/信号量）。凭据解锁对多主机可能逐个弹窗（需批量解锁）。

**macOS 验证**：选 2-3 台主机（或本机多端口 sshd）批量执行 `uptime`，结果应聚合展示。

**工作量**：M（2 天）

---

## F3. MCP Client（接入外部 MCP server 扩展 AI）

**问题**：ROADMAP 规划项，代码零实现。MCP（Model Context Protocol）可让 uniTerm AI 调用外部工具服务器，大幅扩展能力。

**现状证据**：grep `mcp` 零结果。

**方案**：
1. 设置页加"MCP Server"管理（添加 server：name + command/URL + env）。
2. 新增 `frontend/src/services/mcp/client.ts`：实现 MCP 客户端（stdio 或 SSE transport），连接 server、list_tools、call_tool。
3. 桥接到 AI Agent：MCP server 暴露的工具动态注册到 `toolRegistry`（依赖 A3），schema 转换为 LLM tool schema，execute 转调 `mcp.callTool`。
4. system prompt 注入可用 MCP 工具说明。
5. 风险：MCP 工具执行结果回传 AI，需对大输出截断。

**破坏性**：🟢 低（纯新增）→ 依赖 A3（注册表化后桥接更自然，否则又加 runAgent 分支）。

**风险**：MCP 协议较新，需选稳定 SDK（`@modelcontextprotocol/sdk` 若有 TS 实现）。stdio transport 需后端 Go 侧管理子进程（Wails 绑定）。

**依赖**：A3（工具注册表化）。

**macOS 验证**：接入一个示例 MCP server（如 filesystem server），AI 调用其工具成功。

**工作量**：L（3 天）

---

## F4. 终端录制与回放

**问题**：竞品常见能力，uniTerm 缺失。`session:data` 已有完整数据流，录制成本低。

**现状证据**：无录制功能；`sessionStore` 已缓存 session 数据。

**方案**：
1. 终端标签页加"录制"按钮，开启后 `session:data` 同步写入 asciinema cast v2 格式文件（`~/.uniterm/records/<id>.cast`，JSON header + 时间戳+数据行）。
2. 新增 `RecordList.vue`：列出录制文件，点击回放。
3. 回放器：用 xterm.js + 按时间戳重放（asciinema player 或自实现轻量播放器，支持暂停/加速/拖拽进度）。
4. 录制开关可全局默认开/关（设置）。

**破坏性**：🟢 低。纯新增。

**风险**：录制含敏感输出（密码输入回显），需提示用户或提供"录制时暂停敏感输入"选项。文件大小需控制（长会话 → 大文件，可加自动分段）。

**macOS 验证**：录制一段 SSH 操作 → 回放，时序与内容应一致。

**工作量**：M（1.5 天）

---

# 风险与回滚策略

- **每批独立分支**：每个批次在独立 git 分支实施，验证通过后合并，出问题可整批回滚。
- **大重构前打 tag**：批次 4（A1/A2/A3）前打 `pre-refactor` tag，便于对比/回滚。
- **回归清单**：A1（17 种 Tab）、A3（AI 多轮任务）需完整手测清单（见各项验证节）。
- **渐进式开关**：S1（host key 策略可选 Off）、S2（本地防线可关）、P2（节流可降级）等加设置开关，便于出问题时快速退回旧行为。

# 验证环境缺口

以下项的**动态验证需你提供远程资源**，否则我只能静态改 + 你来验证：

| 项 | 需要的资源 |
|----|-----------|
| S1（host key 变更告警分支） | 一台可重置密钥的 SSH 测试机 |
| P1（大目录/大结果集压测） | SFTP 服务器（数千文件）+ 大表数据库 |
| P2（高频输出/Zmodem） | SSH 测试机（可 cat 大文件 + rz/sz） |
| F2（批量多主机） | 2-3 台 SSH 主机 |
| F3（MCP） | 一个示例 MCP server |

macOS 本机可验证的：S2/S3/S4/P3/P4/A5/F1/F4 + 所有项的编译通过性。

# 下一步

请审阅本方案。你可以：
1. **逐项批准/驳回/调整**：告诉我哪些项做、哪些不做、哪些改优先级。
2. **指定先实施哪个批次**：建议从批次 1（安全闭环）开始。
3. **补充材料**：特别是上节"验证环境缺口"中的远程资源，以及 AI Agent 实际使用情况（用哪个模型、是否遇过 risk 误判）。

你拍板后，我即按批准的项与顺序进入实施阶段。
---

# P0 Bug 修复（2026-10-20）

> 状态：✅ 已完成 ｜ commit：`6ff01cbb` ｜ 分支：`feature/sync-upstream-20261016`

| Issue | 标题 | 根因 | 修复 | 验证 |
|-------|------|------|------|------|
| #1028 | 清屏与清滚动缓冲行为互换 | `renderTerminalData` 剥离 `\x1b[3J` 并将 `\x1b[2J` 替换为换行填充（MobaXterm 风格），导致 `clear` 把内容推入滚动缓冲 | 移除 `\x1b[3J` 剥离和 `\x1b[2J` 替换，让 xterm.js 原生处理 | vite build ✅ |
| #902 | 中文右边界显示不全 | xterm.js v6 默认 Unicode 6 宽度表对 CJK 全角字符计数错误 | Unicode 11 已加载并激活（既有修复），补充注释说明根因 | 代码审查 ✅ |
| #814 | 退格键删除提示符 | 特定 shell（Euler OS）`stty erase` 不匹配时退格键越过行首 | `onData` 回调添加防御性检查：`cursorIndex===0` 且非 alternate screen 时抑制退格键 | vite build ✅ |

**修改文件**：
- `frontend/src/components/BaseTerminal.vue` — `renderTerminalData` 清屏修复 + `onData` 退格键防御
- `frontend/src/services/terminalManager.ts` — Issue #902 CJK 根因注释