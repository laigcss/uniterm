# ai-ops-terminal 鸿蒙适配（路径 D）

## 架构概述

本目录是 ai-ops-terminal 的鸿蒙（HarmonyOS）应用壳骨架，采用 **路径 D** 适配方案：

```
┌─────────────────────────────────────────────┐
│              HarmonyOS 设备                   │
│                                               │
│  ┌───────────────────────────────────────┐   │
│  │         ArkTS 应用壳 (本工程)           │   │
│  │                                         │   │
│  │  ┌─────────────┐    ┌───────────────┐  │   │
│  │  │  EntryAbility │    │  Index (ArkWeb) │  │   │
│  │  │  (应用入口)    │    │  (WebView 组件) │  │   │
│  │  └──────┬──────┘    └───────┬───────┘  │   │
│  │         │                     │          │   │
│  │         ▼                     │          │   │
│  │  ┌─────────────┐              │          │   │
│  │  │ NativeProcess │             │          │   │
│  │  │ (NDK execve)  │             │          │   │
│  │  └──────┬──────┘              │          │   │
│  │         │                     │          │   │
│  └─────────┼─────────────────────┼──────────┘   │
│            │                     │              │
│            ▼                     │              │
│  ┌─────────────────┐             │              │
│  │  Go 二进制子进程   │◄──────────┘ HTTP/WS      │
│  │  (静态链接 ELF)    │  localhost:9245          │
│  │                   │                          │
│  │  • HTTP API       │                          │
│  │  • WebSocket 事件  │                          │
│  │  • WebSocket 终端  │                          │
│  │  • 前端静态资源     │                          │
│  └───────────────────┘                          │
└─────────────────────────────────────────────┘
```

### 运行原理

1. **应用启动**：HarmonyOS 加载 ArkTS 应用壳，`EntryAbility` 初始化
2. **释放 Go 二进制**：将 `resources/rawfile/` 中内嵌的 Go 二进制复制到应用沙箱可写目录（`filesDir`），赋予执行权限
3. **启动子进程**：通过 NDK `fork + execve` 系统调用启动 Go 二进制作为子进程
4. **等待就绪**：轮询 `http://localhost:9245/` 健康检查，等待 HTTP 服务器就绪
5. **加载前端**：ArkWeb 组件加载 `http://localhost:9245`，显示 Vue 3 + xterm.js 前端 UI

### 路径 D 的核心思路

Go 语言不支持 `GOOS=ohos`，无法直接编译为鸿蒙原生应用。但通过 Wails v3 的 **server 模式**，可以将 Go 后端编译为 **静态链接的 ELF ARM64 二进制**（无 CGO 依赖），在鸿蒙设备上作为子进程运行。Go 后端启动后监听 `localhost:9245`，提供：

- HTTP API（REST 接口）
- WebSocket 事件推送
- WebSocket 终端流
- 前端静态资源服务

ArkWeb 组件（基于 V8 引擎）加载该地址即可显示完整的前端 UI，无需修改任何前端代码。

## 构建步骤

### 前置条件

- DevEco Studio 5.0.0+
- HarmonyOS SDK（API 12+）
- Go 1.21+（用于交叉编译 Go 二进制）
- 鸿蒙 NDK（用于编译 `libnative_process.so`）

### 步骤 1：构建 Go 二进制

```bash
# 在项目根目录运行构建脚本
# 该脚本会使用 Go 交叉编译生成静态链接的 ELF ARM64 二进制
# 构建标签: server（启用 Wails server 模式，无 CGO，headless）
scripts/build-harmonyos.sh
```

构建脚本会生成 `bin/ai-ops-terminal-harmonyos-arm64` 二进制文件。

### 步骤 2：复制二进制到鸿蒙工程

```bash
# 将 Go 二进制复制到 rawfile 目录（打包进应用）
cp bin/ai-ops-terminal-harmonyos-arm64 \
   harmonyos/entry/src/main/resources/rawfile/ai-ops-terminal
```

### 步骤 3：编译 NDK 原生库

```bash
# 使用鸿蒙 NDK 编译 native_process.c 为 libnative_process.so
# （在 DevEco Studio 中会自动编译，或手动使用 clang 交叉编译）
cd harmonyos/libs/arm64-v8a/
# 具体编译命令见 native_process.c 文件头部注释
```

### 步骤 4：构建鸿蒙应用

```bash
# 用 DevEco Studio 打开 harmonyos/ 目录
# 点击 Build > Build HAP(s) 构建应用包
# 或使用命令行:
hvigorw assembleHap
```

## 目录结构

```
harmonyos/
├── README.md                              # 本文件
├── build-profile.json5                    # 鸿蒙工程构建配置
├── oh-package.json5                       # 鸿蒙包配置
├── entry/
│   └── src/
│       └── main/
│           ├── module.json5               # 模块配置（Ability + 权限声明）
│           ├── resources/
│           │   ├── rawfile/               # Go 二进制存放位置（打包进应用）
│           │   │   └── .gitkeep           # 占位（实际二进制由构建脚本放入）
│           │   └── base/                  # 资源文件（字符串、颜色、页面路由）
│           │       ├── element/
│           │       │   ├── string.json
│           │       │   └── color.json
│           │       └── profile/
│           │           └── main_pages.json
│           └── ets/
│               ├── entryability/
│               │   └── EntryAbility.ets   # 应用入口 Ability
│               ├── pages/
│               │   └── Index.ets          # 主页面（ArkWeb 组件）
│               └── utils/
│                   └── NativeProcess.ets  # NDK 子进程管理工具类
└── libs/
    └── arm64-v8a/
        ├── native_process.c               # NDK C 代码（fork + execve）
        └── libnative_process.so           # NDK 编译产物（占位）
```

## 关键技术点

### 1. Go 二进制释放

鸿蒙应用的 `resources/rawfile/` 目录是 **只读** 的，无法直接执行其中的二进制。需要在应用启动时：

1. 从 `rawfile` 读取 Go 二进制数据
2. 写入应用沙箱的可写目录（`context.filesDir`）
3. 调用 NDK `chmod()` 赋予执行权限（`0o755`）

### 2. NDK execve 启动子进程

通过 NDK 的 `fork + execve` 系统调用启动 Go 二进制：

- `fork()` 创建子进程
- `execve()` 在子进程中加载 Go 二进制
- 父进程保存子进程 PID，用于后续管理
- ArkTS 通过 **Node-API (NAPI)** 调用 C 原生方法

### 3. 健康检查

Go 后端启动需要时间（初始化日志、加载配置等）。应用通过轮询 `http://localhost:9245/` 判断服务器是否就绪：

- 轮询间隔：500ms
- 最大等待时间：30s
- 收到 HTTP 200 响应即认为就绪

### 4. 进程生命周期管理

- 应用启动时创建子进程
- 应用退出时（`aboutToDisappear`）发送 `SIGTERM` 终止子进程
- 避免子进程成为孤儿进程，造成资源泄漏

### 5. ArkWeb 配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `javaScriptAccess` | `true` | 启用 JavaScript（Vue 3 需要） |
| `domStorageAccess` | `true` | 启用 DOM Storage（localStorage） |
| `fileAccess` | `true` | 启用文件访问 |
| `geolocationAccess` | `true` | 启用地理位置 |
| `mixedMode` | `MixedMode.All` | 允许混合内容（WebSocket ws:// 非 wss://） |

## 已知限制

| 限制 | 说明 | 影响范围 |
|------|------|----------|
| **文件对话框不可用** | Wails 的 `dialog` API 在 server 模式下为 no-op，无法弹出原生文件选择框 | 文件上传/保存需通过 ArkWeb 的 `<input type="file">` 或 ArkTS FilePicker 实现 |
| **剪贴板不可用** | Wails 的 `clipboard` API 在 server 模式下为 no-op | 复制/粘贴需通过 ArkWeb 的 `navigator.clipboard` API 或 JSBridge 实现 |
| **窗口管理为 no-op** | Wails 的 `window` API（最小化、最大化、置顶等）在 server 模式下为 no-op | 窗口操作由鸿蒙系统窗口管理器接管 |
| **系统托盘不可用** | server 模式无系统托盘功能 | 无后台常驻托盘图标 |
| **WebSocket 跨域** | ArkWeb 的 origin 与 Go 服务器 host 不匹配 | Go 端已设置 `WebSocketAllowAllOrigins: true` 解决 |
| **二进制大小** | Go 静态链接二进制约 60MB+ | 增加 HAP 包体积 |

## 环境变量

Go 后端支持以下环境变量（在启动子进程时设置）：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `AI_OPS_HOST` | `localhost` | HTTP 服务器监听地址 |
| `AI_OPS_PORT` | `9245` | HTTP 服务器监听端口 |

## 相关文档

- [鸿蒙适配可行性评估](../HARMONYOS_FEASIBILITY_ASSESSMENT.md) - 完整的鸿蒙适配可行性分析
- [Wails v3 Server 模式](https://v3alpha.wails.io/guides/server/) - Wails server 模式文档
- [ArkWeb 组件文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkweb-ndk-jsbridge) - 鸿蒙 ArkWeb NDK JSBridge
- [鸿蒙 NDK 开发](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ndk-development) - 鸿蒙 NDK 开发指南