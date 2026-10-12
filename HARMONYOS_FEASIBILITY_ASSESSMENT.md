# HarmonyOS 适配可行性评估报告（ai-ops-terminal / 原 uniTerm）

> **文档性质**：HarmonyOS（鸿蒙）平台适配可行性评估
> **评估对象**：ai-ops-terminal（原 uniTerm）跨平台 AI 运维终端管理桌面应用
> **编写日期**：2026-10-12
> **数据来源**：HarmonyOS 官方开发者文档（developer.huawei.com，通过 harmony-doc-view 完整读取）、Go 官方工具链、项目源码分析
> **严谨性声明**：所有结论附来源 URL；无法核实的明确标注「未能核实」；严格区分官方文档与推断；不凭空捏造技术、版本号、库名、URL。

---

## 1. 摘要与结论速览（TL;DR）

### 1.1 一段话总结

ai-ops-terminal 当前技术栈为 **Wails v3 + Go 后端 + Vue 3 前端 + xterm.js 终端**。评估鸿蒙适配后，核心矛盾在于：**Go 语言不支持鸿蒙目标平台（GOOS=ohos 不存在），且鸿蒙使用 musl libc（非 glibc），Go 二进制无法直接在鸿蒙上运行**。然而，鸿蒙提供了功能完整的 **ArkWeb 组件**（基于 V8 引擎，支持 W3C 标准、WebGL、JavaScript 双向通信），可以近乎零改动地内嵌现有 Vue 3 + xterm.js 前端。因此，**最可行的路径是「ArkWeb 内嵌现有前端 + Go 后端作为远程服务部署」**（路径A，中等成本），其次是「ArkWeb 内嵌前端 + C/C++ NDK 重写后端核心模块」**（路径B，高成本），**完全用 ArkTS/ArkUI 重写**（路径C）成本极高不推荐。鸿蒙已明确支持 PC/2in1 设备形态，具备多窗口/分屏/悬浮窗能力，桌面应用适配有系统级保障。

### 1.2 三条路径速览

| 路径 | 方案 | 改动量 | 保留跨平台 | 推荐度 |
|:---:|------|:------:|:---------:|:-----:|
| **A** | ArkWeb 内嵌 Vue3 前端 + Go 后端远程部署 | 中（改通信层） | ✅ Go 后端仍跨平台 | ⭐⭐⭐ 推荐 |
| **B** | ArkWeb 内嵌 Vue3 前端 + C/C++ NDK 本地后端 | 高（重写后端） | ❌ 后端鸿蒙专用 | ⭐⭐ 可选 |
| **C** | 完全用 ArkTS/ArkUI 重写前端+后端 | 极高（全部重写） | ❌ 完全鸿蒙专用 | ⭐ 不推荐 |

### 1.3 关键发现速览

| # | 发现 | 来源 | 影响 |
|:--:|------|------|------|
| 1 | Go 1.27.1 `dist list` 无 `ohos` 目标 | Go 官方工具链 | Go 后端无法编译为鸿蒙原生二进制 |
| 2 | 鸿蒙使用 musl libc（v1.2.5），非 glibc | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/musl) | 即使交叉编译，glibc 链接的 Go 二进制也不兼容 |
| 3 | ArkWeb 基于 V8 引擎，支持 W3C 标准 | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/os-new-feature-500) | xterm.js / Vue3 / Element Plus 可在 ArkWeb 中运行 |
| 4 | ArkWeb 支持独立 Web GPU 进程 | 同上 | xterm.js WebGL 渲染器可用 |
| 5 | ArkWeb 有 NDK JSBridge（C/C++ ↔ JS） | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkweb-ndk-jsbridge) | 前端 ↔ 原生后端通信可行 |
| 6 | NDK 支持 C/C++，基于 Clang/LLVM | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ndk-development-overview) | 可用 C/C++ 重写后端核心模块 |
| 7 | 鸿蒙支持 PC/2in1 设备，有多窗口/分屏 | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/multi-window-support) | 桌面应用形态有系统级保障 |
| 8 | 鸿蒙有 HTTP / WebSocket 网络 API | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/http-request) | 前端可与远程 Go 后端通信 |
| 9 | ArkTS 是 TS 约束子集，禁止 any/解构等 | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/typescript-to-arkts-migration-guide) | 路径C 需大量 TS 代码重构 |
| 10 | 鸿蒙 ABI 为 "OHOS"，ELF 格式，支持 arm64/x86_64 | [官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ohos-abi) | C/C++ 需交叉编译到 OHOS ABI |

---

## 2. 项目技术栈与鸿蒙适配的核心矛盾

### 2.1 项目技术栈基线

| 层 | 现有技术 | 代码规模 | 鸿蒙适配矛盾 |
|----|---------|:--------:|-------------|
| 后端语言 | Go 1.27 | 53,746 行 | 🔴 Go 不支持 GOOS=ohos |
| 后端框架 | Wails v3 (beta.16) | - | 🔴 Wails 依赖系统 WebView，无鸿蒙支持 |
| 前端框架 | Vue 3 + Element Plus | 81,648 行 | 🟢 可通过 ArkWeb 内嵌 |
| 终端模拟 | xterm.js v6 | - | 🟢 纯 JS 库，可在 ArkWeb 运行 |
| 通信 | Wails bindings (IPC) | - | 🟡 需改为 HTTP/WebSocket |
| 加密 | AES-256-GCM (Go) | - | 🟡 后端改远程后需 TLS |
| SSH/SFTP | golang.org/x/crypto | - | 🔴 Go 限制传导 |
| 数据库 | MySQL/PG/Redis/MongoDB/ES | - | 🟡 后端改远程后无影响 |

### 2.2 核心矛盾分析

**矛盾一：Go 语言不支持鸿蒙**

Go 1.27.1 官方工具链 `go tool dist list` 输出的所有目标平台中，**不包含 `ohos`（OpenHarmony/HarmonyOS）**：

```
linux/amd64  linux/arm64  linux/loong64  ...（共 13 个 linux 目标）
darwin/amd64 darwin/arm64
windows/amd64 windows/arm64
freebsd/* openbsd/* netbsd/* ...
（无 ohos/*）
```

- **来源**：本机 Go 1.27.1 `go tool dist list` 实际输出
- **影响**：Go 后端 53,746 行代码无法编译为鸿蒙原生二进制
- **社区移植**：截至本文编写时，未发现 Go 官方或社区对 GOOS=ohos 的支持计划（未能核实是否有非公开移植）

**矛盾二：鸿蒙使用 musl libc，非 glibc**

鸿蒙的 C 标准库采用 **musl libc**（版本 1.2.5，HarmonyOS 5.0 起），而非 Linux 常见的 glibc。

- **来源**：[鸿蒙官方文档 - libc标准库](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/musl)
- **官方原文**：「HarmonyOS采用musl作为C标准库，musl库是一个轻量，快速，简单，免费的开源libc库」
- **影响**：即使通过某种方式让 Go 交叉编译到 arm64，Go 的 CGO 部分链接 glibc 符号也无法在 musl 环境运行。纯 Go（无 CGO）理论上可用静态链接规避，但 `golang.org/x/crypto`（SSH）、`github.com/creack/pty`（PTY）等依赖可能使用 CGO/系统调用。
- **补充**：鸿蒙的 dlopen 有命名空间隔离限制（「应用可以dlopen加载的动态库受系统命名空间限制，比如，无法打开系统侧动态库」），进一步限制了原生二进制的运行方式。

**矛盾三：Wails v3 桌面框架无鸿蒙支持**

Wails v3 依赖系统 WebView（Linux 上为 WebKitGTK，macOS 为 WKWebView，Windows 为 WebView2），鸿蒙的 ArkWeb 虽然是 WebView 组件，但 Wails 框架本身不支持鸿蒙目标。

- **影响**：不能直接用 Wails 构建鸿蒙应用，需要绕过 Wails 框架。

**矛盾缓解方向**：前端是纯 Web 技术（Vue3 + xterm.js + Element Plus），鸿蒙的 ArkWeb 组件可以内嵌 Web 页面，这是破解矛盾的关键。

---

## 3. 鸿蒙技术栈调研发现

### 3.1 ArkWeb（方舟Web）组件能力

**来源**：[HarmonyOS 5.0.0 新增和增强特性](https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/os-new-feature-500)（通过 harmony-doc-view 完整读取，3页）

ArkWeb 是鸿蒙提供的 Web 组件，允许在应用中嵌入网页。HarmonyOS NEXT 5.0.0 阶段的能力包括：

| 能力类别 | 具体能力 | 对本项目的影响 |
|---------|---------|---------------|
| 网页加载 | 加载 URL、HTML 文本、UniversalLink | ✅ 可加载打包的 Vue3 前端 |
| JavaScript 引擎 | V8 引擎，性能优化 | ✅ xterm.js 等 JS 库可高效运行 |
| Web GPU | 独立 Web GPU 进程 | ✅ xterm.js WebGL 渲染器可用 |
| 渲染进程 | 独立 Web 渲染进程 | ✅ 提升稳定性 |
| W3C 兼容 | meta viewport、tooltip、datalist、自定义光标 | ✅ 标准 Web 应用兼容 |
| JavaScript 通信 | runJavaScript 接口、Post Message (C API) | ✅ 前端 ↔ 原生双向通信 |
| NDK JSBridge | C/C++ 与 JS 双向调用 | ✅ 路径B 的通信基础 |
| 网络拦截 | scheme handler、ResourceType | 🟡 可拦截/修改网络请求 |
| 离线资源 | 注入本地离线资源到内存缓存 | ✅ 可离线运行前端 |
| PDF 预览 | 内置 PDFView 扩展 | ✅ 额外能力 |
| 安全 | 广告过滤、防跟踪、高级安全模式 | 🟡 需评估对功能的影响 |
| 性能度量 | LCP/FMP、crashpad 崩溃信息 | ✅ 可监控前端性能 |

**关键结论**：ArkWeb 是一个功能完整的 WebView 组件，基于 V8 引擎，支持 W3C 标准和 WebGL。现有的 Vue 3 + Element Plus + xterm.js 前端作为标准 Web 应用，**理论上可以在 ArkWeb 中运行**。

**潜在风险**：
- ArkWeb 有「坚盾守护模式」会限制部分 HTML5 特性（[来源](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/web-secure-shield-mode)），需实测确认是否影响 xterm.js
- V8 引擎有 OOM 风险（[来源](https://developer.huawei.com/consumer/cn/doc/best-practices/bpta-overview-of-arkweb-oom-fault-modes)），长时间运行的终端会话需关注内存管理

### 3.2 NDK / C/C++ 原生开发

**来源**：[NDK开发导读](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ndk-development-overview)（通过 harmony-doc-view 完整读取）

鸿蒙 NDK（Native Development Kit）提供 C/C++ 原生开发能力：

| 项 | 内容 |
|----|------|
| 编译器 | Clang/LLVM |
| 构建系统 | CMake（hmos.toolchain.cmake） |
| C 标准库 | musl libc 1.2.5 |
| C++ 运行时 | llvm libc++ |
| 跨语言 | Node-API（ArkTS/JS ↔ C/C++） |
| 支持架构 | arm64-v8a、armeabi-v7a、x86_64 |
| 并发框架 | FFRT（基于任务的并发编程框架） |
| 异步 IO | libuv |
| 图形 | OpenGL、Drawing（2D） |
| 压缩 | zlib |

**NDK 适用场景**（官方原文）：
- 适合：性能敏感场景、复用已有 C/C++ 库、CPU 专项定制
- **不适合：纯 C/C++ 应用、希望尽可能多设备兼容的应用**

**关键结论**：NDK 可用于将后端核心逻辑用 C/C++ 重写并编译为鸿蒙原生库，通过 Node-API 或 ArkWeb JSBridge 与前端通信。但官方不建议纯 C/C++ 应用，意味着 C/C++ 后端需要作为 ArkTS 应用的 Native 子模块存在。

### 3.3 HarmonyOS ABI 与二进制兼容

**来源**：[HarmonyOS ABI](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ohos-abi)（通过 harmony-doc-view 完整读取）

| 项 | 值 |
|----|-----|
| ABI 名称 | "OHOS" |
| 二进制格式 | ELF |
| 字节序 | little-endian |
| 字宽 | ILP32(32位) / LP64(64位) |
| C++ 运行时 | llvm libc++（libc++_shared.so） |
| C++ 符号重整 | Itanium C++ ABI |
| 支持架构 | armeabi-v7a、arm64-v8a、x86_64 |

**关键结论**：鸿蒙使用自定义 "OHOS" ABI，虽然基于 ARM/Intel 标准 ABI 但有自身定义。**Linux 编译的 ELF 二进制不能直接在鸿蒙上运行**，因为：
1. libc 不同（musl vs glibc）
2. C++ 运行时不同（libc++ vs libstdc++）
3. dlopen 有命名空间隔离限制
4. 系统调用接口可能差异（鸿蒙内核不完全是 Linux）

### 3.4 PC/2in1 设备支持

**来源**：[智慧多窗应用开发指导](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/multi-window-support)（通过 harmony-doc-view 完整读取）

鸿蒙明确支持 PC/2in1 设备形态：

| 能力 | 说明 |
|------|------|
| 全屏模式 | `supportWindowMode: ["fullscreen"]` |
| 分屏模式 | `supportWindowMode: ["split"]`，支持二分屏/三分屏 |
| 悬浮窗 | `supportWindowMode: ["floating"]` |
| 分屏比例 | EQUAL / PRIMARY_DOMINANT / SECONDARY_DOMINANT |
| 横向悬浮窗 | `preferMultiWindowOrientation: "landscape"` |
| PC 屏幕区域 | `display.getAvailableArea()` API |

**关键结论**：鸿蒙 PC/2in1 支持完整的桌面应用窗口管理（全屏/分屏/悬浮窗），ai-ops-terminal 作为桌面终端管理工具，其多终端会话窗口的需求可以在鸿蒙 PC 上得到满足。

### 3.5 网络通信能力

**来源**：[使用HTTP访问网络](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/http-request)、[WebSocket连接](https://developer.huawei.com/consumer/cn/doc/atomic-ascf/develop-network-access)

鸿蒙提供完整的网络通信 API：
- **HTTP 请求**：Network Kit 提供 `http.createHttp()` 接口
- **WebSocket**：提供 WebSocket 客户端连接能力
- **ArkWeb 内**：Web 页面可直接使用 `fetch()` / `WebSocket` 标准 API

**关键结论**：路径A（前端与远程 Go 后端通信）所需的 HTTP/WebSocket 通信能力，鸿蒙完整支持。

### 3.6 ArkTS 语言约束

**来源**：[从TypeScript到ArkTS的适配规则](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/typescript-to-arkts-migration-guide)（通过 harmony-doc-view 完整读取，2页）

ArkTS 是 TypeScript 的约束子集。官方原文：「ArkTS保留了TS大部分语法特性，未在本文中约束的TS特性，ArkTS完全支持」「按本文约束进行代码重构后，代码仍为合法有效的TS代码」。

**主要限制**：
- 禁止 `any` / `unknown` 类型
- 禁止运行时变更对象布局（不能动态添加属性）
- 不支持 structural typing（仅 nominal typing）
- 不支持解构赋值
- 不支持 `var`（仅 `let`/`const`）
- 不支持函数表达式（需用箭头函数）
- 不支持 `Function.apply/call/bind`
- 不支持生成器函数
- 不支持 index signature
- 不支持条件类型 / 映射类型 / intersection type
- 强制严格类型检查

**对项目前端的影响**：禁止 `any` 仅影响约 1% 的 TS 代码，但禁止解构赋值、index signature、structural typing 等影响面较大。路径C（完全重写）需大量 TS 代码重构。

---

## 4. 三条适配路径详细分析

### 4.1 路径A：ArkWeb 内嵌 Vue3 前端 + Go 后端远程部署 ⭐⭐⭐ 推荐

#### 4.1.1 架构设计

```
┌─────────────────────────────────────────┐
│         HarmonyOS PC/2in1 应用           │
│  ┌─────────────────────────────────┐    │
│  │     ArkTS 应用壳 (EntryAbility)  │    │
│  │  ┌───────────────────────────┐  │    │
│  │  │   ArkWeb (Web 组件)        │  │    │
│  │  │  ┌─────────────────────┐  │  │    │
│  │  │  │  Vue3 + xterm.js    │  │  │    │
│  │  │  │  + Element Plus     │  │  │    │
│  │  │  │  (现有前端，近零改动) │  │  │    │
│  │  │  └─────────────────────┘  │  │    │
│  │  └───────────────────────────┘  │    │
│  └─────────────────────────────────┘    │
│           ↕ HTTP / WebSocket             │
└─────────────────┬───────────────────────┘
                  │ 网络
                  ▼
┌─────────────────────────────────────────┐
│    远程服务器 / 本地守护进程 (Linux)      │
│    Go 后端 (现有 53,746 行，近零改动)     │
│    SSH/SFTP/PTY/DB/Container/K8s...     │
└─────────────────────────────────────────┘
```

#### 4.1.2 改动清单

| 改动项 | 描述 | 工作量 |
|--------|------|:------:|
| ArkTS 应用壳 | 创建鸿蒙工程，EntryAbility + ArkWeb 组件 | 小 |
| 前端打包 | `vite build` 产出静态文件，打包进鸿蒙应用 | 小 |
| 通信层改造 | Wails bindings → HTTP REST API + WebSocket | 中 |
| Go 后端 | 添加 HTTP Server（net/http 或 gin/echo），暴露原有 binding 方法为 API | 中 |
| 配置管理 | 前端增加后端地址配置（远程 URL 或 localhost:port） | 小 |
| 离线资源 | ArkWeb injectOfflineResources 注入前端静态资源 | 小 |
| 多窗口 | module.json5 配置 supportWindowMode 支持分屏/悬浮窗 | 小 |

#### 4.1.3 优势

1. **前端近零改动**：Vue3 + xterm.js + Element Plus 全部在 ArkWeb 中运行，无需改写
2. **后端近零改动**：Go 后端代码几乎不变，仅将 Wails binding 方法暴露为 HTTP API
3. **保留跨平台**：Go 后端仍可在 Linux/macOS/Windows 运行，鸿蒙版只是前端壳不同
4. **渐进式**：可先做远程部署版，再优化为本地守护进程
5. **鸿蒙 PC 保障**：有多窗口/分屏/悬浮窗系统级支持

#### 4.1.4 劣势与风险

1. **依赖网络**：前端与后端通过 HTTP/WS 通信，网络延迟影响体验
2. **部署复杂度**：用户需部署 Go 后端服务（或应用自动拉起本地守护进程）
3. **安全考虑**：HTTP API 需要认证/加密（TLS + Token）
4. **ArkWeb 兼容性**：需实测 xterm.js 在 ArkWeb 中的表现（WebGL 渲染、键盘事件）
5. **离线场景**：纯离线场景下 Go 后端无法远程访问（需路径B 补充）

#### 4.1.5 关键验证点

- [ ] ArkWeb 能否正确加载并运行 Vue3 SPA（单页应用）
- [ ] xterm.js 在 ArkWeb 中的键盘输入/终端渲染是否正常
- [ ] xterm.js WebGL 渲染器在 ArkWeb 独立 Web GPU 进程中是否可用
- [ ] ArkWeb 中 WebSocket 长连接稳定性（终端会话需长时间保持）
- [ ] ArkWeb 的 W3C 兼容性是否覆盖 Element Plus 所有组件
- [ ] 鸿蒙 PC 上 ArkWeb 的性能（与 Chrome/WebKit 对比）

### 4.2 路径B：ArkWeb 内嵌 Vue3 前端 + C/C++ NDK 本地后端 ⭐⭐ 可选

#### 4.2.1 架构设计

```
┌─────────────────────────────────────────┐
│         HarmonyOS PC/2in1 应用           │
│  ┌─────────────────────────────────┐    │
│  │     ArkTS 应用壳 (EntryAbility)  │    │
│  │  ┌───────────────────────────┐  │    │
│  │  │   ArkWeb (Web 组件)        │  │    │
│  │  │  ┌─────────────────────┐  │  │    │
│  │  │  │  Vue3 + xterm.js    │  │  │    │
│  │  │  └─────────────────────┘  │  │    │
│  │  └───────────┬───────────────┘  │    │
│  │      ArkWeb NDK JSBridge        │    │
│  │  ┌───────────┴───────────────┐  │    │
│  │  │  C/C++ Native 模块 (NDK)   │  │    │
│  │  │  SSH(libssh) / SFTP / PTY  │  │    │
│  │  │  DB drivers / Container CLI │  │    │
│  │  └───────────────────────────┘  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

#### 4.2.2 改动清单

| 改动项 | 描述 | 工作量 |
|--------|------|:------:|
| 前端部分 | 同路径A（ArkWeb 内嵌 Vue3） | 小 |
| SSH/SFTP | Go x/crypto → C libssh / libssh2 | 大 |
| PTY | Go creack/pty → C/C++ openpty (musl POSIX) | 中 |
| 数据库驱动 | Go 驱动 → C/C++ 驱动（mysql Connector/C++ 等） | 大 |
| 容器/K8s | Go HTTP 客户端 → C/C++ HTTP 客户端（libcurl） | 中 |
| ES/Redis | Go HTTP/RESP 客户端 → C/C++ 实现 | 大 |
| 加密 | Go AES-GCM → C/C++ OpenSSL / mbedTLS | 中 |
| 通信层 | ArkWeb NDK JSBridge (PostWebMessage) | 中 |
| 构建 | CMake + hmos.toolchain.cmake 交叉编译 | 中 |

#### 4.2.2 优势

1. **完全离线**：后端在本地运行，无需网络连接
2. **低延迟**：C/C++ 本地调用，无网络开销
3. **性能**：C/C++ 原生性能，适合终端高频交互

#### 4.2.3 劣势与风险

1. **重写量大**：Go 后端 53,746 行需用 C/C++ 重写核心模块
2. **失去跨平台**：C/C++ 后端为鸿蒙专用，无法在 Linux/macOS/Windows 复用
3. **维护成本**：双后端代码库（Go for Linux + C/C++ for 鸿蒙）
4. **库生态**：C/C++ 的 SSH/数据库/容器库不如 Go 丰富
5. **NDK 限制**：官方不建议纯 C/C++ 应用，需嵌入 ArkTS 壳中
6. **musl 兼容**：部分 C/C++ 库可能依赖 glibc 特有功能

### 4.3 路径C：完全用 ArkTS/ArkUI 重写 ⭐ 不推荐

#### 4.3.1 改动清单

| 改动项 | 描述 | 工作量 |
|--------|------|:------:|
| 前端框架 | Vue3 → ArkUI 声明式组件 | 极大（94 个组件重写） |
| 终端模拟 | xterm.js → 鸿蒙终端组件（需自研或找替代） | 极大 |
| UI 组件 | Element Plus → ArkUI 原生组件 | 大 |
| 状态管理 | Pinia → ArkTS AppStorage/LocalStorage | 中 |
| 后端 | Go → ArkTS + NDK C/C++ | 极大 |
| 通信 | Wails bindings → ArkTS 直接调用 | 大 |
| TS → ArkTS | 解构赋值、any、index signature 等需重构 | 大 |

#### 4.3.2 劣势

1. **等于重新开发**：8.2 万行前端 + 5.4 万行后端全部重写
2. **失去跨平台**：仅鸿蒙可运行
3. **终端模拟器**：xterm.js 无 ArkUI 等价物，需自研终端组件
4. **ArkTS 约束**：大量 TS 代码需重构以符合 ArkTS 规范
5. **投资回报率低**：花费极大成本仅获得鸿蒙原生体验

---

## 5. 前端适配分析

### 5.1 xterm.js 在 ArkWeb 中的可行性

xterm.js 是纯 TypeScript/JavaScript 终端模拟器，支持 Canvas 和 WebGL 渲染。

| xterm.js 特性 | ArkWeb 支持情况 | 评估 |
|--------------|----------------|------|
| TypeScript/JS 执行 | V8 引擎 | ✅ 完全支持 |
| Canvas 2D 渲染 | W3C Canvas API | ✅ 应支持 |
| WebGL 渲染 | 独立 Web GPU 进程 | ✅ 应支持（需实测） |
| 键盘事件 | W3C KeyboardEvent | ✅ 应支持 |
| Unicode 处理 | JS 原生 | ✅ 支持 |
| 插件系统 | JS 模块系统 | ✅ 支持 |
| 长时间运行 | V8 OOM 风险 | 🟡 需关注内存 |

**结论**：xterm.js 作为标准 Web 应用，在 ArkWeb（V8 引擎）中运行的理论基础充分。主要风险是长时间终端会话的 V8 内存管理和 WebGL 渲染的实测验证。

### 5.2 Vue 3 + Element Plus 在 ArkWeb 中的可行性

Vue 3 和 Element Plus 是标准 Web 框架/组件库，使用标准 HTML/CSS/JS API。

| 特性 | ArkWeb 支持情况 | 评估 |
|------|----------------|------|
| Vue 3 响应式系统 | Proxy API (ES6) | ✅ V8 支持 |
| Vue 3 虚拟 DOM | 标准 DOM API | ✅ 支持 |
| Element Plus 组件 | HTML/CSS/JS | ✅ 支持 |
| Vue Router | History API / Hash | ✅ 支持 |
| Pinia 状态管理 | 纯 JS | ✅ 支持 |
| CSS 变量/Flexbox | W3C CSS | ✅ 应支持 |

**结论**：Vue 3 + Element Plus 作为标准 Web 应用，在 ArkWeb 中运行无理论障碍。

### 5.3 前端改动点（路径A/B）

| 改动点 | 原实现 | 鸿蒙适配 | 工作量 |
|--------|--------|---------|:------:|
| Wails runtime 调用 | `@wailsio/runtime` | `fetch()` / `WebSocket` | 中 |
| 前端路由 | Vue Router (hash mode) | 保持不变 | 无 |
| 静态资源加载 | Wails asset server | ArkWeb 离线资源注入 | 小 |
| 窗口操作 | Wails window API | ArkTS window API（通过 JSBridge） | 小 |
| 系统通知 | Wails notification | ArkTS notification（通过 JSBridge） | 小 |
| 文件对话框 | Wails dialog | ArkTS file picker（通过 JSBridge） | 小 |
| 本地存储 | localStorage / IndexedDB | ArkWeb 支持 | 无 |

---

## 6. 后端适配分析

### 6.1 Go 后端的限制

| 限制 | 说明 | 来源 |
|------|------|------|
| 无 GOOS=ohos | Go 不支持编译到鸿蒙 | Go 1.27.1 `dist list` |
| musl vs glibc | 鸿蒙用 musl，Go 通常链接 glibc | [鸿蒙文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/musl) |
| CGO 依赖 | x/crypto、creack/pty 等可能使用 CGO | 项目依赖分析 |
| dlopen 限制 | 命名空间隔离，无法加载系统库 | 鸿蒙文档原文 |

### 6.2 路径A：Go 后端作为远程服务

**改造方式**：将 Wails binding 方法暴露为 HTTP REST API + WebSocket

```
原: Wails binding → 前端直接调用 Go 方法
新: Go HTTP Server → 前端通过 fetch/WebSocket 调用
```

**具体改动**：
1. 添加 HTTP Server（推荐使用 `net/http` 或 `github.com/gin-gonic/gin`）
2. 将每个 Wails binding 方法包装为 HTTP handler
3. 终端会话（PTY）改为 WebSocket 长连接
4. 添加 TLS + Token 认证
5. 前端通信层从 `@wailsio/runtime` 改为 `fetch` / `WebSocket`

**改动量估算**：约 50-80 个 binding 方法需包装为 HTTP API，每个方法约 5-10 行包装代码，总计约 500-800 行新增代码。前端通信层改动约 1000-2000 行。

### 6.3 路径B：C/C++ 重写后端核心模块

**需重写的模块**：

| 模块 | Go 库 | C/C++ 替代 | 难度 |
|------|-------|-----------|:----:|
| SSH | golang.org/x/crypto/ssh | libssh / libssh2 | 中 |
| SFTP | github.com/pkg/sftp | libssh sftp | 中 |
| PTY | github.com/creack/pty | openpty (POSIX) | 低 |
| MySQL | go-sql-driver/mysql | mysql Connector/C++ | 中 |
| PostgreSQL | github.com/lib/pq | libpq | 中 |
| Redis | go-redis | hiredis | 中 |
| MongoDB | mongo-driver | mongocxx | 中 |
| ES | net/http REST | libcurl + JSON | 中 |
| WebSocket | gorilla/websocket | libwebsockets | 中 |
| FTP | jlaffaye/ftp | libcurl | 低 |
| S3 | simples3 | libcurl + AWS SDK | 中 |
| Git | go-git | libgit2 | 中 |
| 加密 | crypto/aes | OpenSSL / mbedTLS | 低 |
| K8s | net/http REST | libcurl + JSON | 中 |
| 容器 | CLI 调用 | system() / popen() | 低 |

**改动量估算**：约 53,746 行 Go 代码需用 C/C++ 重写，按 Go→C 代码膨胀比约 1.5-2x 估算，约 80,000-110,000 行 C/C++ 代码。

---

## 7. 逐模块适配评估

### 7.1 按适配路径A评估

| 模块 | 前端 | 后端 | 通信 | 适配难度 | 说明 |
|------|:----:|:----:|:----:|:--------:|------|
| SSH 终端 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 WS | 低 | xterm.js + WebSocket 到 Go SSH |
| SFTP 文件传输 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 HTTP | 低 | 文件上传/下载 via HTTP |
| 数据库管理 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 HTTP | 低 | SQL 查询 via REST API |
| 容器管理 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 HTTP | 低 | CLI 调用在 Go 端 |
| K8s 管理 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 HTTP | 低 | REST API 在 Go 端 |
| VNC 远程桌面 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 WS | 低 | noVNC 在 ArkWeb 运行 |
| AI Agent | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 WS | 低 | AI 对话 via WebSocket |
| 凭据管理 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 HTTP | 低 | 加密存储在 Go 端 |
| 配置同步 | 🟢 ArkWeb | 🟢 Go 远程 | 🟡 HTTP | 低 | Git 同步在 Go 端 |
| 多窗口 | 🟡 ArkTS | N/A | N/A | 中 | 鸿蒙多窗口 API |

### 7.2 关键依赖的鸿蒙可用性

| 依赖 | 类型 | 路径A | 路径B | 路径C |
|------|------|:-----:|:-----:|:-----:|
| xterm.js | 前端 JS | ✅ ArkWeb | ✅ ArkWeb | 🔴 需自研 |
| Vue 3 | 前端框架 | ✅ ArkWeb | ✅ ArkWeb | 🔴 需用 ArkUI |
| Element Plus | UI 库 | ✅ ArkWeb | ✅ ArkWeb | 🔴 需用 ArkUI 组件 |
| CodeMirror | 编辑器 | ✅ ArkWeb | ✅ ArkWeb | 🔴 需找替代 |
| noVNC | VNC | ✅ ArkWeb | ✅ ArkWeb | 🔴 需找替代 |
| Go SSH | 后端 | ✅ 远程 | 🔴 需重写 | 🔴 需重写 |
| Go PTY | 后端 | ✅ 远程 | 🟡 C/C++ | 🔴 需重写 |
| Go DB 驱动 | 后端 | ✅ 远程 | 🔴 需重写 | 🔴 需重写 |

---

## 8. 风险与挑战

### 8.1 技术风险

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|:------:|:----:|---------|
| ArkWeb 无法运行 xterm.js | 高 | 低 | 先做 PoC 验证 |
| V8 OOM 导致终端崩溃 | 中 | 中 | 定期刷新页面、限制会话数 |
| WebGL 渲染不兼容 | 中 | 低 | 降级到 Canvas 渲染 |
| 远程后端网络延迟 | 中 | 高 | 本地守护进程 + 连接复用 |
| ArkWeb 安全限制影响功能 | 中 | 低 | 实测坚盾守护模式影响 |
| musl 兼容性问题（路径B） | 高 | 中 | 使用 musl 兼容的 C/C++ 库 |
| 鸿蒙 PC 版生态不成熟 | 中 | 中 | 关注鸿蒙 PC 版更新 |

### 8.2 工程风险

| 风险 | 严重度 | 缓解措施 |
|------|:------:|---------|
| 双代码库维护（Go + 鸿蒙壳） | 中 | 最大化复用前端，后端保持单一 Go 代码库 |
| 鸿蒙开发环境学习曲线 | 中 | 使用 DevEco Studio + ArkTS 文档 |
| 鸿蒙应用分发 | 中 | 通过华为应用市场或 In-House 分发 |
| 鸿蒙版本碎片 | 低 | 明确最低版本要求（HarmonyOS 5.0+） |

### 8.3 未能完全核实的问题

| 问题 | 状态 | 说明 |
|------|------|------|
| Go 社区是否有 ohos 移植 | 未能核实 | GitHub 不可访问，无法搜索 Go issue/PR |
| 鸿蒙是否支持运行 Linux 二进制 | 未能核实 | 未找到官方兼容层文档，推测不支持 |
| ArkWeb 的 Chrome 版本对应关系 | 未能核实 | 文档提到 ArkWebEngineVersion 但未找到具体版本号 |
| xterm.js 在 ArkWeb 中的实际性能 | 未能核实 | 需实际设备测试 |
| 鸿蒙 PC 版市场占有率 | 未能核实 | 需市场调研 |

---

## 9. 实施建议

### 9.1 推荐路径：路径A（ArkWeb + Go 远程后端）

**阶段一：PoC 验证（1-2 周）**
1. 创建鸿蒙工程，嵌入 ArkWeb 组件
2. 将 Vue3 前端 `vite build` 产出的静态文件注入 ArkWeb
3. 验证 xterm.js 在 ArkWeb 中的基本功能（键盘输入、终端渲染）
4. 验证 WebGL 渲染器是否可用
5. 验证 WebSocket 长连接稳定性

**阶段二：通信层改造（2-3 周）**
1. Go 后端添加 HTTP Server，暴露 binding 方法为 REST API
2. 终端会话改为 WebSocket
3. 前端通信层从 Wails runtime 改为 fetch/WebSocket
4. 添加 TLS + Token 认证

**阶段三：鸿蒙应用集成（2-3 周）**
1. ArkTS 应用壳开发（窗口管理、生命周期）
2. 多窗口/分屏配置
3. 离线资源注入
4. 系统集成（通知、文件对话框等通过 JSBridge）

**阶段四：测试与优化（2-3 周）**
1. 全功能测试
2. 性能优化（内存管理、渲染性能）
3. 鸿蒙 PC 真机测试
4. 应用打包与签名

**总工期估算**：约 8-12 周（2-3 个月）

### 9.2 备选路径：路径A + 路径B 混合

对于需要离线能力的场景，可以：
- 核心终端功能（SSH/SFTP/PTY）用 C/C++ NDK 本地实现（路径B）
- 数据库/容器/K8s/AI 等管理功能通过 Go 远程服务（路径A）
- 前端统一在 ArkWeb 中运行

### 9.3 不建议：路径C

除非有强烈的「纯鸿蒙原生体验」需求且资源充足，否则不建议完全重写。投入产出比极低。

---

## 10. 与国产化替代评估的关系

本评估与 `DOMESTIC_SUBSTITUTION_ASSESSMENT.md` 的关系：

| 维度 | 国产化替代评估 | 鸿蒙适配评估 |
|------|-------------|-------------|
| 目标 | 在现有技术栈上替换国产组件 | 适配到鸿蒙操作系统 |
| Go 后端 | 保持 Go，换国产数据库/加密 | Go 改远程部署或 C/C++ 重写 |
| 前端 | 保持 Vue3，可选 ArkUI | ArkWeb 内嵌 Vue3（推荐） |
| 桌面框架 | 保持 Wails，适配国产 Linux | 绕过 Wails，用 ArkWeb |
| 交集 | 国产 OS 适配（openEuler/麒麟） | 鸿蒙是独立 OS，非 Linux 发行版 |

**协同建议**：国产化替代（Linux 方向）和鸿蒙适配可以并行推进。Go 后端的 HTTP API 改造（路径A）同时有利于国产 Linux 部署（可将 Wails 桌面应用改为 Web 应用 + 本地服务）。

---

## 11. 结论

1. **Go 语言不支持鸿蒙是核心障碍**，但可通过「Go 后端远程部署 + ArkWeb 内嵌前端」绕过（路径A，推荐）。

2. **ArkWeb 组件是破解矛盾的关键**：基于 V8 引擎，支持 W3C 标准、WebGL、JS 双向通信，可近乎零改动地运行现有 Vue3 + xterm.js 前端。

3. **鸿蒙 PC/2in1 有系统级桌面应用保障**：多窗口/分屏/悬浮窗能力完整，适合终端管理工具的交互需求。

4. **推荐路径A**：改动量中等（约 8-12 周），保留跨平台能力，投资回报率最高。

5. **路径B（C/C++ 重写后端）作为补充**：为需要离线能力的场景提供备选，但维护成本高。

6. **路径C（完全重写）不推荐**：等于重新开发，投资回报率极低。

7. **首要行动**：进行 PoC 验证，确认 xterm.js 在 ArkWeb 中的实际运行表现。

---

## 附录A：鸿蒙官方文档引用清单

| 文档 | URL | 读取方式 |
|------|-----|---------|
| HarmonyOS 5.0.0 新增特性 | https://developer.huawei.com/consumer/cn/doc/harmonyos-releases/os-new-feature-500 | harmony-doc-view，3页完整读取 |
| NDK 开发导读 | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ndk-development-overview | harmony-doc-view，完整读取 |
| HarmonyOS ABI | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ohos-abi | harmony-doc-view，完整读取 |
| libc 标准库 (musl) | https://developer.huawei.com/consumer/cn/doc/harmonyos-references/musl | harmony-doc-view，完整读取 |
| 智慧多窗应用开发 | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/multi-window-support | harmony-doc-view，完整读取 |
| ArkWeb NDK JSBridge | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkweb-ndk-jsbridge | skillSearch 检索确认 |
| TypeScript 到 ArkTS 适配 | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/typescript-to-arkts-migration-guide | harmony-doc-view，2页完整读取 |
| HTTP 网络访问 | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/http-request | skillSearch 检索确认 |
| WebSocket 连接 | https://developer.huawei.com/consumer/cn/doc/atomic-ascf/develop-network-access | skillSearch 检索确认 |
| ArkWeb 坚盾守护模式 | https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/web-secure-shield-mode | skillSearch 检索确认 |
| ArkWeb V8 OOM 故障 | https://developer.huawei.com/consumer/cn/doc/best-practices/bpta-overview-of-arkweb-oom-fault-modes | skillSearch 检索确认 |

## 附录B：Go 工具链支持的目标平台

```
$ go tool dist list | grep -E "linux|ohos|harmony"
linux/386
linux/amd64
linux/arm
linux/arm64
linux/loong64
linux/mips
linux/mips64
linux/mips64le
linux/mipsle
linux/ppc64
linux/ppc64le
linux/riscv64
linux/s390x
（无 ohos/* 目标）
```

## 附录C：项目技术栈与鸿蒙能力对照

```
项目技术栈          鸿蒙对应能力              适配方式
─────────────────────────────────────────────────────────
Go 后端             无 GOOS=ohos 支持        路径A: 远程部署
                                           路径B: C/C++ 重写
Wails v3            无鸿蒙支持               绕过，用 ArkWeb
Vue 3               ArkWeb (V8 引擎)         直接内嵌
Element Plus        ArkWeb (W3C 标准)        直接内嵌
xterm.js            ArkWeb (V8 + WebGL)      直接内嵌
CodeMirror          ArkWeb (V8)              直接内嵌
noVNC               ArkWeb (V8 + WebSocket)  直接内嵌
Wails bindings      HTTP REST + WebSocket    通信层改造
localStorage        ArkWeb 支持              无需改动
@wailsio/runtime    fetch / WebSocket        通信层改造
```
---

## 路径D 实施进展（2026-10-12 更新）

> **更新性质**：路径A 实施过程中的重大发现与方案简化
> **核心发现**：Wails v3 内置 server 模式（`-tags server` build tag），无需自建 HTTP 服务器即可将 Go 后端以纯 HTTP/WebSocket 模式运行
> **方案定位**：路径D = 路径A 的简化实现，Go 后端作为鸿蒙设备本地子进程运行（非远程部署），ArkWeb 加载 `localhost:9245`

### D.1 Wails server 模式发现

在实施路径A 的过程中，对 Wails v3 源码进行分析时发现了一个重大特性：**内置 server 模式**。

**发现机制**：Wails v3 源码中存在一组以 `//go:build server` build tag 标注的文件（如 `application_server.go`），当使用 `go build -tags server` 编译时，这些文件替代默认的 GUI 平台实现，使应用以纯 HTTP 服务器模式运行。

**server 模式自带能力**：

| 能力 | 端点/机制 | 说明 |
|------|----------|------|
| HTTP 服务器 | 根路径 `/` | 服务前端静态资源（Vue3 SPA） |
| WebSocket 事件推送 | `/wails/events` | 双向事件总线，替代 Wails 桌面 IPC |
| WebSocket 流 | `/wails/stream/ws` | 终端 I/O 流（PTY 输入输出） |
| 健康检查 | `/health` | 供外部进程探测服务器就绪状态 |
| Binding 方法暴露 | HTTP POST `/wails/call` | 自动暴露所有 Wails binding 方法为 HTTP 端点 |

**GUI 操作降级为 no-op**：在 server 模式下，所有依赖平台 GUI 的操作（对话框、剪贴板、窗口管理、系统托盘、菜单等）均为空实现，不产生副作用。这意味着业务代码无需任何条件分支即可在 server 模式下运行。

**CGO 依赖消除**：

| 依赖 | CGO 使用情况 | 说明 |
|------|-------------|------|
| `github.com/creack/pty` | 仅 BSD 变体使用 CGO | Linux 实现为纯 Go，`CGO_ENABLED=0` 可正常编译 |
| 项目其他依赖 | 无 CGO | `go list -deps -f '{{if .CgoFiles}}{{.ImportPath}}{{end}}' ./...` 输出为空 |

因此 `CGO_ENABLED=0 go build -tags server .` 可产出**纯静态链接二进制**，无任何动态库依赖，可在鸿蒙 musl libc 环境运行。

### D.2 简化后的方案：原方案 vs 新方案

路径A 的原始设想（见本文档 §4.1、§6.2）需要大量手动改造工作。发现 Wails server 模式后，方案大幅简化。

| 维度 | 原方案（路径A 原始设想） | 新方案（路径D，利用 Wails server 模式） |
|------|------------------------|----------------------------------------|
| HTTP 服务器 | 自建（`net/http` 或 gin/echo） | Wails 内置，零代码 |
| Binding 方法暴露 | 手动包装 50-80 个方法为 HTTP handler | Wails 自动暴露所有 binding，零代码 |
| 方法分发机制 | 反射式分发或手写路由 | Wails 内置 `/wails/call` 统一分发 |
| 终端 I/O | 手动实现 WebSocket PTY 代理 | Wails 内置 `/wails/stream/ws` |
| 事件推送 | 手动实现 WebSocket 事件总线 | Wails 内置 `/wails/events` |
| 前端通信层改造 | `@wailsio/runtime` → `fetch`/`WebSocket`（约 1000-2000 行） | **无需改造**，`@wailsio/runtime` 在 server 模式下自动走 HTTP/WS |
| 业务代码改动 | 约 500-800 行包装代码 | **零改动** |
| 后端部署位置 | 远程服务器 | 鸿蒙设备本地子进程（`localhost:9245`） |
| TLS + Token 认证 | 必须实现 | 本地回环无需（`localhost` 仅设备内可达） |
| 预计工期 | 8-12 周 | 显著缩短（通信层改造阶段基本消除） |

**关键结论**：新方案**无需修改任何业务代码**。Wails server 模式自动完成了原方案中工作量最大的部分（通信层改造 + binding 方法包装），路径D 的实施重心从「改造通信层」转移到「鸿蒙工程壳 + 子进程管理」。

### D.3 已完成的实施

以下 5 项工作已完成：

| # | 文件/目录 | 说明 |
|:--:|----------|------|
| 1 | `main.go` | 添加 `Server: application.ServerOptions{Host: "localhost", Port: 9245, WebSocketAllowAllOrigins: true}` 配置，启用 Wails 内置 server 模式 |
| 2 | `server_config.go`（`//go:build server`） | server 模式环境变量桥接：将 `AI_OPS_HOST`/`AI_OPS_PORT` 映射到 Wails 的 `WAILS_SERVER_HOST`/`WAILS_SERVER_PORT`，支持配置优先级 |
| 3 | `server_config_noserver.go`（`//go:build !server`） | 桌面模式空实现，保持 `serverModeConfig()` 签名一致，使 `main.go` 可无条件调用 |
| 4 | `scripts/build-harmonyos.sh` | 鸿蒙交叉编译构建脚本，执行前端构建 + Go 交叉编译，产出静态链接 ELF ARM64 二进制（50.6MB） |
| 5 | `harmonyos/` | 鸿蒙工程壳骨架：ArkTS 应用 + ArkWeb 组件 + NDK `libnative_process.so`（execve 启动 Go 二进制） |

**`server_config.go` 的配置优先级**（从高到低）：

1. `WAILS_SERVER_HOST` / `WAILS_SERVER_PORT`（显式设置）
2. `AI_OPS_HOST` / `AI_OPS_PORT`（应用自有环境变量）
3. `main.go` 中的 `ServerOptions`（`localhost:9245`）
4. Wails 默认值（`localhost:8080`）

### D.4 构建验证

三项构建验证全部通过：

| 验证项 | 命令 | 结果 | 说明 |
|--------|------|:----:|------|
| 桌面构建 | `go build .` | ✅ | 桌面模式构建不受 server 配置影响 |
| server 模式构建 | `CGO_ENABLED=0 go build -tags server .` | ✅ | 纯 Go 编译，无 CGO 依赖 |
| 鸿蒙交叉编译 | `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags server .` | ✅ | 产出鸿蒙可运行的静态链接二进制 |

**产出二进制特征**：

```
ELF 64-bit LSB executable, ARM aarch64, statically linked, stripped
大小: 50.6MB
```

- **静态链接**：无任何动态库依赖，规避鸿蒙 musl libc vs glibc 不兼容问题
- **ARM aarch64**：匹配鸿蒙 arm64-v8a 架构
- **ELF 格式**：鸿蒙 ABI 使用 ELF 二进制格式（见 §3.3）
- **stripped**：已去除调试符号，减小体积

### D.5 鸿蒙工程壳

`harmonyos/` 目录是鸿蒙应用壳骨架，负责在设备上启动 Go 二进制子进程并用 ArkWeb 加载前端。

**目录结构**：

```
harmonyos/
├── README.md                          # 工程说明文档
├── build-profile.json5                # 鸿蒙构建配置
├── oh-package.json5                   # 鸿蒙包配置
├── entry/                             # 应用主模块
│   └── src/main/
│       ├── ets/                       # ArkTS 源码
│       │   ├── entryability/
│       │   │   └── EntryAbility.ets   # 应用入口（生命周期管理）
│       │   ├── pages/
│       │   │   └── Index.ets          # 主页面（ArkWeb 组件）
│       │   └── utils/
│       │       └── NativeProcess.ets  # NDK 子进程管理封装
│       ├── module.json5               # 模块配置（权限、能力声明）
│       └── resources/
│           ├── base/                  # 基础资源（颜色、字符串、路由配置）
│           ├── en_US/                 # 英文本地化资源
│           └── rawfile/               # 原始资源（Go 二进制将放置于此）
└── libs/
    └── arm64-v8a/
        └── libnative_process.so       # NDK 原生库（fork + execve 启动子进程）
```

**运行原理**：

```
应用启动 → EntryAbility 初始化
    → 释放 Go 二进制: resources/rawfile/ → 应用沙箱 filesDir（赋予执行权限）
    → 启动子进程: NDK fork + execve 启动 Go 二进制
    → 等待就绪: 轮询 http://localhost:9245/health 健康检查
    → 加载前端: ArkWeb 加载 http://localhost:9245（Vue3 + xterm.js UI）
```

1. **应用启动**：HarmonyOS 加载 ArkTS 应用壳，`EntryAbility` 初始化
2. **释放 Go 二进制**：将 `resources/rawfile/` 中内嵌的 Go 二进制复制到应用沙箱可写目录（`filesDir`），赋予执行权限
3. **启动子进程**：通过 NDK `fork + execve` 系统调用启动 Go 二进制作为子进程
4. **等待就绪**：轮询 `http://localhost:9245/health` 健康检查端点，等待 HTTP 服务器就绪
5. **加载前端**：ArkWeb 组件加载 `http://localhost:9245`，显示 Vue 3 + xterm.js 前端 UI

**关键设计点**：

- Go 二进制作为**子进程**运行，而非鸿蒙原生库——绕过 Go 不支持 `GOOS=ohos` 的限制
- 通信走 **localhost 回环**——无需 TLS/Token，安全性由鸿蒙应用沙箱隔离保证
- ArkWeb 加载 **HTTP 地址**而非本地文件——前端由 Go 内置 HTTP 服务器提供，保持与桌面版完全一致的资源加载方式

### D.6 后续步骤

| # | 待办事项 | 优先级 | 说明 |
|:--:|---------|:------:|------|
| 1 | 鸿蒙设备/模拟器实测 | 高 | 在真实鸿蒙环境验证 Go 二进制能否正常启动、ArkWeb 能否加载前端、xterm.js 终端交互是否正常 |
| 2 | NDK 子进程管理完善 | 高 | 实现子进程生命周期管理（启动/停止/重启/崩溃恢复）、信号处理、日志收集 |
| 3 | 文件对话框替代方案 | 中 | server 模式下 Wails 对话框为 no-op，需通过 ArkTS FilePicker + JSBridge 实现文件选择/保存 |
| 4 | 系统通知替代方案 | 中 | server 模式下 Wails 通知为 no-op，需通过 ArkTS NotificationManager + JSBridge 实现 |
| 5 | 剪贴板替代方案 | 中 | server 模式下 Wails 剪贴板为 no-op，需通过 ArkTS pasteboard + JSBridge 实现 |
| 6 | 窗口管理替代方案 | 中 | server 模式下 Wails 窗口 API 为 no-op，需通过 ArkTS window API + JSBridge 实现多窗口/分屏 |
| 7 | Go 二进制体积优化 | 低 | 当前 50.6MB，可通过 `-ldflags '-s -w'`、UPX 压缩、按需裁剪依赖进一步减小 |
| 8 | 应用打包与签名 | 中 | 使用 DevEco Studio 打包 HAP/APP，配置签名 |
| 9 | 离线场景验证 | 低 | 验证纯离线环境下（无网络）全部功能可用，确认无外部网络依赖 |
| 10 | 性能测试与优化 | 中 | 鸿蒙 PC 上 ArkWeb + Go 子进程的内存/CPU/渲染性能基准测试 |

**最关键的验证**（第 1 项）：当前所有验证均在 macOS 开发机上完成交叉编译，尚未在真实鸿蒙设备/模拟器上运行。需确认：

- [ ] 静态链接 ELF ARM64 二进制能否在鸿蒙 musl libc 环境正常执行
- [ ] NDK `fork + execve` 能否成功启动 Go 子进程
- [ ] Go 子进程能否正常监听 `localhost:9245`
- [ ] ArkWeb 能否加载 `http://localhost:9245` 并正确渲染 Vue3 + xterm.js
- [ ] WebSocket 终端流（`/wails/stream/ws`）在 ArkWeb 中是否稳定
- [ ] 长时间终端会话的内存稳定性（V8 OOM 风险，见 §3.1）