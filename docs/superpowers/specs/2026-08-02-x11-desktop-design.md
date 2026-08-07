# X11 Desktop 连接类型

## 概述

给 uniTerm 加一个"远程桌面"分类下的新连接类型 `x11-desktop`：保存一条
记录时同时保存**桌面环境**（GNOME/KDE/XFCE/.../Custom）和**一个已存在
的 SSH 连接引用**。点击连接时，uniTerm 复用现有的 X11 forward 机制
（最近合并的 PR #472）打开 SSH、调 x11-req、在远端 shell 里跑桌面启
动命令。远端 X 客户端的窗口通过 SSH X11 转发通道出现在本机 X server
（VcXsrv / XQuartz / Xorg）上，**不**在 uniTerm webview 里渲染。

uniTerm 在连接期间只显示一个**状态控制 tab**（连接状态、远端主机、
桌面类型、本地 X server 名字、Disconnect 按钮），不试图把 X11 画在
uniTerm 窗口里——浏览器没有现成的 X11 客户端，自研代价远超收益。

## 范围

新增：

- `backend/session/x11_desktop_session.go` — `X11DesktopSession` 类型
  + `Connect` / `Disconnect` 实现
- `backend/session/x11_desktop_session_test.go` — 桌面命令映射 +
  配置校验单测
- `frontend/src/components/X11DesktopTabContent.vue` — 状态控制 tab
- i18n 9 个 locale 文件加键

修改：

- `backend/session/session.go` — `ConnectionConfig` 加
  `X11DesktopSSHConnID` / `X11DesktopDesktopType` / `X11DesktopCustomCmd`
  三个字段
- `backend/session/manager.go` — `Create` switch 加 `"x11-desktop"`
  case
- `backend/session/ssh_dial.go` 已有的 `DialSSHClient` 直接复用
- `app.go` — 加 `X11DesktopConnect(connectionID)` 方法（参照
  `ContainerConnect` 的引用解析 + 凭据合并 + 隧道处理模式），并在
  `CreateSession` 里给 `x11-desktop` 加特判不走通用 launch goroutine
- `frontend/src/components/ConnectionForm.vue` — 子类型 + 表单字段
  + 校验 + i18n key 引用
- `frontend/src/types/session.ts` — type union 加 `'x11-desktop'` +
  三个字段
- `frontend/src/App.vue` — 路由到 `X11DesktopTabContent` + 全局事件
  监听 + `onConnectX11Desktop`

**不在范围内**：

- 在 uniTerm webview 里渲染 X11 画面（明确不做，原因：浏览器没有现
  成的 X11 客户端，自研代价大且稳定性差）
- 把 X11 窗口吸附进 uniTerm 主窗口做 overlay（VNC/RDP 的嵌入渲染模
  式不适用本场景——本机 X server 的多窗口是 OS 自己的窗口）
- XDM-AUTHORIZATION-1 等非 MIT-MAGIC-COOKIE-1 协议（沿用
  x11_forward.go 的现状）
- 跨跳板链上的 X11 desktop（跳板链是 tunnel_forward.go 的事，与本
  设计无关）
- 自定义 X server 启动参数（用户自备 VcXsrv/XQuartz/Xorg）
- 多显示器 / DPI 调整 / 色彩深度协商

## 背景

最近合并的 X11 forward 特性（PR #472，`feat/x11-forwarding`）在
`backend/session/x11.go` / `x11_xauth.go` / `x11_forward.go` 里已经
实现了完整的 SSH X11 转发栈。它目前只能在 SSH 终端 session 里用——
用户在 xterm.js 里手动敲 `xclock` 之类的命令，窗口出现在本机 X
server 上。X11 Desktop 类型把这套机制**抽出来变成独立入口**：用户
配一条记录，点连接，自动 SSH 上去 + 跑桌面命令。

为什么不直接用"开 SSH 终端 + 在 shell 里跑 `gnome-session`"？

- 没有专门的"桌面"语义：用户得自己写启动命令、自己处理 SSH 凭据、
  自己确认 `$DISPLAY` 通
- 关闭 SSH 终端 = 关闭桌面（X11 forward 跟着 SSH session 走），容
  易误操作
- 没法批量管理桌面（侧边栏没有"X11 桌面"这个类目）

## 架构

### 复用关系

```
ConnectionConfig{Type: "x11-desktop", X11DesktopSSHConnID: "<ssh-id>", X11DesktopDesktopType: "gnome"}
                ↓
前端 onConnectX11Desktop
 ├─ connectionStore.connections.findById(SSHConnID) → sshCfg
 ├─ ensureCredentials(sshCfg) → 提示缺凭据并保存到 connectionStore
 ├─ CreateSession("x11-desktop", x11Cfg)             // 注册 session
 └─ X11DesktopConnect(x11Cfg.id)                     // Wails 调用
                ↓
App 层
 ├─ connectionStore.Load() → x11Cfg
 ├─ connectionStore.Load() → sshCfg (含密码，已 save_and_connect 过)
 ├─ 强制 sshCfg.X11Forwarding = true
 └─ sessionManager.Get(x11Cfg.id) → x11Sess
                ↓
X11DesktopSession.ConnectX11Desktop(x11Cfg, sshCfg)
 ├─ resolveDesktopCommand()  →  "gnome-session"
 ├─ tryStartLocalXServer()        // 复用 x11.go
 ├─ DialLocalX($DISPLAY)          // 复用 x11.go
 ├─ DialSSHClient(sshCfg)         // 复用 ssh_dial.go
 ├─ client.NewSession()
 ├─ startX11Forward(...)          // 复用 x11_forward.go
 └─ session.Run(cmd)              // 阻塞，远端 desktop 退出时返回
                ↓
背景 goroutine：Run 返回 → Disconnect
```

### 会话类型

```go
// X11DesktopSession opens an SSH connection to a remote host with X11
// forwarding enabled, runs the chosen desktop command, and bridges remote
// X11 clients to the local X server at $DISPLAY. The actual desktop is
// rendered by the local X server (VcXsrv/XQuartz/Xorg), not inside uniTerm.
// The session represents the lifecycle of the desktop process: Connected
// while the command is running, Disconnected when it exits.
type X11DesktopSession struct {
    baseSession
    sshClient  *ssh.Client
    sshSession *ssh.Session
    x11Fwd     *x11Forwarder
    quit       chan struct{}
    quitOnce   sync.Once
}
```

不复用 `SSHSession`：它绑的是"开交互式 shell + xterm 渲染"，而
X11Desktop 要的是"跑一个命令直到它退出"。

### 状态机

```
              ┌──────────┐
              │Disconnected│
              └────┬─────┘
                   │ Connect
                   ▼
              ┌──────────┐
              │Connecting│ (本地 X server + SSH + x11-req)
              └────┬─────┘
            ok     │
                   ▼
              ┌──────────┐  Run(cmd) 阻塞  ┌──────────┐
              │Connected ├──────────────►│  后台  │
              └────┬─────┘               │ session.Wait()│
                   │                     └────┬─────┘
                   │ Disconnect              │ cmd exit / SSH drop
                   ▼                          ▼
              ┌──────────┐
              │Disconnected│
              └──────────┘
```

错误态（auth 失败 / 命令找不到 / 本地 X 不可达）→ `StatusError` →
tab 显示错误信息 + Retry 按钮（沿用 VNCTabContent 的错误态样式）。

## 协议细节

### 桌面命令映射

```go
var desktopCommands = map[string]string{
    "gnome":    "gnome-session",
    "kde":      "startkde",
    "xfce":     "startxfce4",
    "mate":     "mate-session",
    "cinnamon": "cinnamon-session",
    "openbox":  "openbox-session",
    // "custom" 不在表里，命令直接用 X11DesktopCustomCmd
}

func resolveDesktopCommand(cfg ConnectionConfig) (string, error) {
    if cfg.X11DesktopDesktopType == "custom" {
        cmd := strings.TrimSpace(cfg.X11DesktopCustomCmd)
        if cmd == "" {
            return "", fmt.Errorf("x11-desktop: custom command is empty")
        }
        return cmd, nil
    }
    cmd, ok := desktopCommands[cfg.X11DesktopDesktopType]
    if !ok {
        return "", fmt.Errorf("x11-desktop: unknown desktop type %q", cfg.X11DesktopDesktopType)
    }
    return cmd, nil
}
```

**关于 shell 解析**：`session.Run(cmd)` 把 `cmd` 当单个字符串传给远
端 sshd，sshd 走 `/bin/sh -c cmd` 执行。如果用户在 Custom 框里写
`mycommand --foo "bar baz"`，shell 会按 POSIX 规则解析——**等价于
`ssh host "mycommand --foo \"bar baz\""`**。这点要在 UI 提示里说明。

### SSH 拨号 helper 复用

`backend/session/ssh_dial.go` 已有的 `DialSSHClient(config
ConnectionConfig) (*ssh.Client, error)` 已经覆盖本设计需要的所有
行为：TCP dial + keepalive + 30s 超时 + NewClientConn。X11Desktop
不需 keyboard-interactive——但 `DialSSHClient` 注册的 kb 回调只在
服务器主动要求时才触发，密码 / key 认证都直接命中，不会走到 kb。

`X11DesktopSession.ConnectX11Desktop` 直接调用 `DialSSHClient(sshCfg)`，不需
要新抽 helper。

## ConnectionConfig 改动

`backend/session/session.go` 加：

```go
// X11Desktop fields. Used when Type == "x11-desktop".
//   SSHConnID   — references an existing ConnectionConfig of Type "ssh".
//                 The referenced SSH config is what actually opens the
//                 connection; X11 forward is forced on (this type is
//                 meaningless without it).
//   DesktopType — "gnome" | "kde" | "xfce" | "mate" | "cinnamon" |
//                 "openbox" | "custom". Mapped to a built-in command or
//                 to CustomCmd verbatim.
//   CustomCmd   — only used when DesktopType == "custom". The string is
//                 passed to sshd verbatim (so it goes through
//                 /bin/sh -c on the remote).
X11DesktopSSHConnID   string `json:"x11DesktopSSHConnId,omitempty"`
X11DesktopDesktopType string `json:"x11DesktopDesktopType,omitempty"`
X11DesktopCustomCmd   string `json:"x11DesktopCustomCmd,omitempty"`
```

## 后端实现要点

### `x11_desktop_session.go`

```go
package session

import (
    "errors"
    "fmt"
    "os"
    "sync"

    "golang.org/x/crypto/ssh"

    "github.com/ys-ll/uniterm/backend/log"
)

type X11DesktopSession struct {
    baseSession
    sshClient  *ssh.Client
    sshSession *ssh.Session
    x11Fwd     *x11Forwarder
    quit       chan struct{}
    quitOnce   sync.Once
}

func NewX11DesktopSession(id string) *X11DesktopSession {
    return &X11DesktopSession{
        baseSession: baseSession{id: id, sessionType: "x11-desktop", status: StatusDisconnected},
        quit:        make(chan struct{}),
    }
}

// ConnectX11Desktop opens SSH with X11 forwarding and runs the desktop
// command. Renamed from Connect(cfg, sshCfg) to coexist with the
// Session-interface stub `Connect(config ConnectionConfig) error` — Go
// has no method overloading, so the two-config and one-config methods
// must have distinct names. The Session-interface stub is the
// no-op-returning-error path used only to satisfy the type system; the
// real entry point is this method, which the X11DesktopConnect App
// method invokes after resolving the referenced SSH config.
func (s *X11DesktopSession) ConnectX11Desktop(cfg ConnectionConfig, sshCfg ConnectionConfig) error {
    s.setStatus(StatusConnecting)

    cmd, err := resolveDesktopCommand(cfg)
    if err != nil {
        s.setStatus(StatusError)
        return err
    }

    // X11 forward is mandatory for this type.
    sshCfg.X11Forwarding = true

    // Make sure a local X server is running.
    if _, derr := DialLocalX(os.Getenv("DISPLAY")); derr != nil {
        if !tryStartLocalXServer() {
            s.setStatus(StatusError)
            return fmt.Errorf("x11-desktop: local X server unreachable: %w", derr)
        }
        if _, derr2 := DialLocalX(os.Getenv("DISPLAY")); derr2 != nil {
            s.setStatus(StatusError)
            return fmt.Errorf("x11-desktop: local X server unreachable after start: %w", derr2)
        }
    }

    client, err := DialSSHClient(sshCfg)
    if err != nil {
        s.setStatus(StatusError)
        return fmt.Errorf("x11-desktop: %w", err)
    }
    s.sshClient = client

    sess, err := client.NewSession()
    if err != nil {
        client.Close()
        s.setStatus(StatusError)
        return fmt.Errorf("x11-desktop: new session: %w", err)
    }
    s.sshSession = sess

    xauthPath := os.Getenv("XAUTHORITY")
    if xauthPath == "" {
        if home, herr := os.UserHomeDir(); herr == nil {
            xauthPath = home + "/.Xauthority"
        }
    }
    fwd, ferr := startX11Forward(client, sess, xauthPath, os.Getenv("DISPLAY"))
    switch {
    case ferr == nil, errors.Is(ferr, errX11TrustedFallback):
        s.x11Fwd = fwd
    default:
        sess.Close()
        client.Close()
        s.setStatus(StatusError)
        return fmt.Errorf("x11-desktop: x11 forward: %w", ferr)
    }

    s.title = fmt.Sprintf("%s @ %s (%s)", cfg.X11DesktopDesktopType, sshCfg.Host, "X11")
    s.setStatus(StatusConnected)

    // Block until remote command exits; report back via status change.
    go func() {
        werr := sess.Run(cmd)
        log.Writef("x11-desktop: command %q exited: %v", cmd, werr)
        s.Disconnect()
    }()

    return nil
}

func (s *X11DesktopSession) Disconnect() error {
    s.quitOnce.Do(func() {
        if s.x11Fwd != nil {
            s.x11Fwd.stop()
            s.x11Fwd = nil
        }
        if s.sshSession != nil {
            s.sshSession.Close()
        }
        if s.sshClient != nil {
            s.sshClient.Close()
        }
        s.setStatus(StatusDisconnected)
    })
    return nil
}

// Read/Write/Resize — not applicable. X11 data flows directly between
// remote X clients and the local X server, bypassing this session.
func (s *X11DesktopSession) Write(_ []byte) error { return fmt.Errorf("x11-desktop: not a terminal session") }
func (s *X11DesktopSession) Resize(_, _ int) error { return nil }

func (s *X11DesktopSession) IsConnected() bool { return s.Status() == StatusConnected }
```

### `manager.go` 接入

```go
case "x11-desktop":
    s = NewX11DesktopSession(config.ID)
```

### `app.go` 流程

参照 `ContainerConnect` 的模式：X11Desktop session 需要两个 config
（x11-desktop 自身 + 解析出的 SSH），通用 `launchConnectGoroutine`
只传一个 config 进去不够用。所以单独开一个 `X11DesktopConnect`
方法，前端走和 Container 一样的两步流程（`CreateSession` 注册，
`X11DesktopConnect` 触发连）。

`X11DesktopConnect` 流程：

```go
// X11DesktopConnect opens the X11 desktop session: resolves the referenced
// SSH config, sets up an X11 forward over that connection, and runs the
// chosen desktop command on the remote. Mirrors ContainerConnect's pattern
// for resolving a referenced SSH connection.
func (a *App) X11DesktopConnect(connectionID string) error {
    data, err := a.connectionStore.Load()
    if err != nil { return err }
    var cfg *session.ConnectionConfig
    for i := range data.Connections {
        if data.Connections[i].ID == connectionID {
            cfg = &data.Connections[i]
            break
        }
    }
    if cfg == nil {
        return fmt.Errorf("connection not found: %s", connectionID)
    }
    if cfg.Type != "x11-desktop" {
        return fmt.Errorf("connection %s is not an x11-desktop", connectionID)
    }
    var sshCfg *session.ConnectionConfig
    for i := range data.Connections {
        if data.Connections[i].ID == cfg.X11DesktopSSHConnID {
            sshCfg = &data.Connections[i]
            break
        }
    }
    if sshCfg == nil {
        return fmt.Errorf("referenced SSH connection missing: %s", cfg.X11DesktopSSHConnID)
    }
    if sshCfg.Type != "ssh" {
        return fmt.Errorf("referenced connection is not SSH: %s", sshCfg.Type)
    }
    // Force X11 forward on the SSH side (this type is meaningless without it).
    // The mutation is on the local copy; the persisted sshCfg in the store is
    // untouched.
    sshCfg.X11Forwarding = true

    sess, err := a.sessionManager.Get(connectionID)
    if err != nil {
        return fmt.Errorf("session not found: %s", connectionID)
    }
    x11Sess, ok := sess.(*session.X11DesktopSession)
    if !ok {
        return fmt.Errorf("session %s is not x11-desktop", connectionID)
    }
    if err := x11Sess.ConnectX11Desktop(*cfg, *sshCfg); err != nil {
        return err
    }
    return nil
}
```

在 `CreateSession` 通用 launch goroutine 路径里加特判：当
`sessionType == "x11-desktop"` 时跳过自动 launch（前端在调
`CreateSession` 时把 `deferConnect: true` 设到 config 里，对应
`ConnectionConfig.DeferConnect`，参考 `ssh_session.go` 已有的
`SetPendingSize` deferred 模式）。由前端显式调
`X11DesktopConnect(id)` 启动。这样 session 在 manager 里注册了
（`CloseSession` 可用），但 `Connect` 走单独的路径能拿到解析后
的 SSH config。

**前置依赖**：被引用的 SSH 配置必须先 `Save and Connect` 过（让
密码落到 connectionStore 里）。`X11DesktopConnect` 拿到的是磁盘版
本，没保存的密码不会出现在 `sshCfg` 里。失败时的错误信息应指明
"Edit the SSH connection and re-save with credentials"——这个 case
已加到错误处理表里。

## 前端改动

### `frontend/src/types/session.ts`

```ts
type: 'ssh' | 'telnet' | ... | 'x11-desktop'  // 联合类型追加
x11DesktopSSHConnId?: string
x11DesktopDesktopType?: 'gnome' | 'kde' | 'xfce' | 'mate' | 'cinnamon' | 'openbox' | 'custom'
x11DesktopCustomCmd?: string
```

### `frontend/src/components/ConnectionForm.vue`

子类型（`categories.remote`）：
```ts
{ type: 'x11-desktop', label: 'X11 Desktop', icon: AppWindow }
```
`icon` 用 `@lucide/vue` 的 `AppWindow`（与 RDP/VNC/SPICE 的 Monitor*
系列区分）。

`REMOTE_TYPES` 加 `'x11-desktop'`。

`TUNNEL_UNSUPPORTED` 加 `'x11-desktop'`（不需要跳板——它本身就靠 SSH
forward）。

表单块（紧跟 VNC 之后）：
```vue
<template v-if="form.type === 'x11-desktop'">
  <el-form-item :label="t('conn.x11DesktopSSH')" required>
    <el-select v-model="form.x11DesktopSSHConnId" filterable>
      <el-option v-for="c in sshConnections" :key="c.id"
                 :label="`${c.name} (${c.user}@${c.host}:${c.port})`"
                 :value="c.id" />
    </el-select>
    <div class="field-hint">{{ t('conn.x11DesktopSSHHint') }}</div>
  </el-form-item>
  <el-form-item :label="t('conn.x11DesktopDE')" required>
    <el-select v-model="form.x11DesktopDesktopType">
      <el-option label="GNOME" value="gnome" />
      <el-option label="KDE" value="kde" />
      <el-option label="XFCE" value="xfce" />
      <el-option label="MATE" value="mate" />
      <el-option label="Cinnamon" value="cinnamon" />
      <el-option label="Openbox" value="openbox" />
      <el-option :label="t('conn.x11DesktopDECustom')" value="custom" />
    </el-select>
  </el-form-item>
  <el-form-item v-if="form.x11DesktopDesktopType === 'custom'"
                :label="t('conn.x11DesktopCustomCmd')" required>
    <el-input v-model="form.x11DesktopCustomCmd"
              :placeholder="t('conn.x11DesktopCustomCmdPlaceholder')" />
    <div class="field-hint">{{ t('conn.x11DesktopCustomCmdHint') }}</div>
  </el-form-item>
</template>
```

校验（参照 `validateContainer` 模式）：
```ts
function validateX11Desktop(): boolean {
  if (form.type !== 'x11-desktop') return true
  if (!form.x11DesktopSSHConnId) {
    ElMessage.error(t('conn.x11DesktopSSHRequired'))
    return false
  }
  if (!sshConnections.value.length) {
    ElMessage.error(t('conn.x11DesktopNoSSH'))
    return false
  }
  if (form.x11DesktopDesktopType === 'custom' && !form.x11DesktopCustomCmd?.trim()) {
    ElMessage.error(t('conn.x11DesktopCustomCmdRequired'))
    return false
  }
  return true
}
```

`onSave` / `onConnect` 在 `validateContainer` 之后跑 `validateX11Desktop`。

`form` reactive 初值加三个字段（默认 GNOME）。

### `frontend/src/components/X11DesktopTabContent.vue`

参照 `VNCTabContent.vue` 的四态布局（connecting / connected /
error / disconnected），但**不挂载任何画布**——只是个信息面板：

- 状态点 + 文案（"Running" / "Connecting..." / "Disconnected" / 错误）
- 标题：`X11 Desktop — <DE> @ <host:port>`
- 本地 X server 信息：`GetPlatform()` 拿平台，渲染 "VcXsrv" /
  "XQuartz" / "Xorg" + `$DISPLAY` 当前值
- 一段提示文字（i18n）：
  "The desktop is shown in your local X server window. Use the system
  taskbar or Alt+Tab to focus it. Closing this tab will terminate the
  desktop session."
- Disconnect 按钮（connected / connecting 状态显示）
- Retry / Reconnect 按钮（error / disconnected 状态显示）

### `frontend/src/App.vue`

- import `X11DesktopTabContent`
- `activeTab.type === 'x11-desktop'` 路由（参照 vnc/rdp/spice）
- `onConnectX11Desktop(config)`：参照 `onConnectVNC` 流程，差异是
  在 `connectionStore.add(config)` 之后多调一步
  `ensureCredentials(sshCfg)` 拿到带凭据的 SSH 配置（必要时弹凭
  据框，并自动 `save_and_connect` 到 store）；`CreateSession` 时
  把 `deferConnect: true` 设到 config 里，触发 `CreateSession` 内
  通用 launch goroutine 路径的特判（见 app.go 流程节末尾）。拿到
  session 后由前端调 `X11DesktopConnect(id)`（在 `app.go` 加绑定）。
- 全局 `app:connect-x11-desktop` CustomEvent 监听（参照 vnc）
- `Tab.type` 联合类型加 `'x11-desktop'`
- `panelStore` 的 panel type 加 `'x11-desktop'`

新增 `frontend/src/services/x11DesktopClient.ts`（参照
`containerClient.ts`）：

```ts
import { X11DesktopConnect } from '../../wailsjs/go/main/App'
export const connect = (id: string) => X11DesktopConnect(id)
// 断开走通用的 CloseSession —— X11Desktop session 已在 sessionManager 中
// 注册，CloseSession(sessionId) 会调到 X11DesktopSession.Disconnect()
```

### i18n 键

`en.json`：
```json
"x11Desktop": "X11 Desktop",
"x11DesktopSSH": "SSH Connection",
"x11DesktopSSHHint": "Select an existing SSH connection. X11 forwarding will be enabled automatically.",
"x11DesktopSSHRequired": "Please select an SSH connection",
"x11DesktopNoSSH": "No SSH connections configured. Create one first.",
"x11DesktopDE": "Desktop Environment",
"x11DesktopDECustom": "Custom Command…",
"x11DesktopCustomCmd": "Command",
"x11DesktopCustomCmdPlaceholder": "e.g. gnome-session --session=foo",
"x11DesktopCustomCmdHint": "Executed on the remote via /bin/sh -c. Use the same syntax as a shell command line.",
"x11DesktopCustomCmdRequired": "Please enter a command"
```

`x11.tab.*` 命名空间（i18n 库用 flat dotted key 查表，下面的 nested 写法仅作示意；locale 文件实际是 12 个 flat dotted 键，与其他命名空间一致）：

```json
"x11.tab.connecting": "Starting X11 desktop…",
"x11.tab.connected": "Running",
"x11.tab.disconnected": "Disconnected",
"x11.tab.error": "Failed to start X11 desktop",
"x11.tab.retry": "Retry",
"x11.tab.reconnect": "Reconnect",
"x11.tab.disconnect": "Disconnect",
"x11.tab.localXServer": "Local X server",
"x11.tab.display": "Display",
"x11.tab.command": "Command",
"x11.tab.localXHint": "The desktop is shown in your local X server window. Use the system taskbar or Alt+Tab to focus it. Closing this tab will terminate the desktop session.",
"x11.tab.localXServerUnknown": "Unknown"
```

9 个 locale 文件各加同样键（zh-CN/zh-TW/ja/ko/ru/es/fr/de 已有的
x11 命名空间可以扩展）。

## 错误/边界处理

| 场景 | 行为 |
|---|---|
| `X11DesktopSSHConnID` 引用不存在 | Connect 返错 "referenced SSH connection not found"，tab error 态 |
| 引用的是非 SSH 类型 | 同上，错误信息指明类型不匹配 |
| SSH 认证失败（密码错 / key 不对） | 沿用 makeSSHAuthMethods 的错误，tab error 态 |
| 本地 X server 没装 / 起不来 | 错误信息含平台提示（复用 `xServerHint(goos)`），tab error 态 |
| `$XAUTHORITY` 缺失 / trusted 降级 | 沿用 `startX11Forward` 的 `errX11TrustedFallback` 处理，连接仍成功 |
| 远端 sshd 关了 X11Forwarding | startX11Forward 报错，tab error 态 |
| 远端没装所选桌面 | `session.Run` 立即退出非 0 → 后台 goroutine 检测到 → Disconnect → tab disconnected 态，错误 "Desktop command exited with code N" |
| 自定义命令在前台立即退出 | 同上 |
| SSH 中途断开 | Run 返回 → Disconnect → tab disconnected 态 |
| 本地 X server 在 X11 desktop 跑着时被关 | `DialLocalX` 在下次 X11 通道来数据时失败，沿用 `onError` 路径，黄色警告打到 SSH stderr（但 session 状态不变） |
| 多次点 Disconnect | 幂等：`sync.Once` + baseSession.setStatus 已是 idempotent |
| Disconnect 时 SSH 已死 | 幂等：client.Close() / session.Close() 多次调用安全 |
| 并发跑多个 X11 desktop | 共享同一个本机 X server，各自独立 SSH session，可行 |
| Mosh / Telnet / 其他非 SSH 类型被引用 | 前端 `sshConnections` filter 限定 `c.type === 'ssh'`，下拉里不出现；后端 `X11DesktopConnect` 加一道 `if sshCfg.Type != "ssh"` 兜底（防止 store 中类型被改） |
| 远端 SSH 连接没存密码（用户没 save_and_connect 过） | `X11DesktopConnect` 拿到无密码 sshCfg → `DialSSHClient` 认证失败 → 错误信息指明"SSH connection has no password saved. Edit the SSH connection and re-save with credentials" |
| 用户在远端 desktop 里 logout | 桌面 session 退出 → Run 返回 → 同"远端没装所选桌面"路径 |

## 降级链路

```
onConnectX11Desktop
  ↓
connectionStore.findById(SSHConnID) — 失败？→ 错误信息
  ↓
ensureCredentials(sshCfg) — 失败？→ 错误信息
  ↓
sessionManager.Create — 失败？→ 错误信息
  ↓
X11DesktopSession.ConnectX11Desktop
  ↓
resolveDesktopCommand — custom 模式空？/ 未知 type？→ 错误
  ↓
DialLocalX($DISPLAY) — 不可达？
  ├─ 是 → tryStartLocalXServer (Windows only)
  │        ├─ 成功 → DialLocalX 再试
  │        └─ 失败 → 错误信息（带平台提示）
  └─ 否
       ↓
DialSSHClient
  ├─ TCP dial 失败？→ 错误
  ├─ SSH handshake 失败？→ 错误
  └─ 成功
       ↓
startX11Forward
  ├─ xauth 缺失 → trusted 降级 + 警告
  ├─ 服务器拒绝 → 错误
  └─ 成功
       ↓
setStatus(Connected)
  ↓
session.Run(cmd) 阻塞
  ├─ cmd 找不到 / 立即退出 → Wait() 返回非 0 → Disconnect
  ├─ SSH 断 → Wait() 返回错误 → Disconnect
  └─ 用户 Disconnect → session.Close() → Wait() 返回 → Disconnect
```

## 测试

### `x11_desktop_session_test.go`

- `TestDesktopCommandMapping`：表驱动，覆盖 6 个预设 + custom + 未知
- `TestResolveCustomEmpty`：custom 模式空命令返错
- `TestResolveUnknownType`：未知 desktop type 返错

集成测试**不进 CI**（要 sshd + X server + 桌面环境），但要写在手
工验证清单里。

## 手工验证清单

1. **本地环回（Linux）**：`wails dev`，连本机 sshd，创建一个
   x11-desktop 记录（DE=Gnome 改成 XFCE，因为本机有 XFCE），点连接。
   VcXsrv/Xorg 窗口里应该出现 XFCE 桌面。
2. **Docker 容器（推荐）**：
   ```bash
   docker run -d --name x11-ssh -p 2222:22 \
     -e SSH_PASSWORD=test123 \
     ghcr.io/linuxserver/openssh-server
   docker exec x11-ssh bash -c "apt update && apt install -y xfce4 xauth dbus-x11"
   ```
   本地 `wails dev` → 创建 SSH 连 127.0.0.1:2222 → 创建 x11-desktop
   引用该 SSH，DE=XFCE → 连 → VcXsrv 窗口里出现 XFCE 桌面。
3. **macOS**：XQuartz 装好开起来，同上跑一遍。
4. **Windows**：装 VcXsrv（默认参数 multiwindow 模式），重复 2/3。
5. **trusted 降级**：临时重命名 `~/.Xauthority` 后再连，警告应出现，
   desktop 仍能开起来（无 cookie 验证）。
6. **远端无 XFCE**：DE=XFCE 容器不装 xfce4 时连，应看到 "command
   not found" 或类似。
7. **Disconnect 幂等**：连上后狂点 Disconnect 按钮，状态应只切一次，
   后台无残留 SSH 进程。
8. **多桌面并发**：开两个 X11 desktop 指向同一 SSH 不同 DE，本机 X
   server 上两个桌面的窗口应同时出现。

## 风险与权衡

- **依赖本机 X server**：跟现有 X11 forward 一样（PR #472）。不重新
  发明。
- **不嵌入 uniTerm 窗口**：浏览器没有现成 X11 客户端，自研代价大
  且效果远不如 VcXsrv/XQuartz/Xorg（无硬件加速、字体支持、剪贴板
  集成、HiDPI 等）。
- **本机 X server 多窗口散落**：用户得自己用 Alt+Tab / 任务栏管理
  窗口。这是 X11 multiwindow 模式的固有行为，跟 OpenSSH/PuTTY/
  Termius 一致。
- **Custom 命令走 `/bin/sh -c`**：用户需了解 shell 解析规则；要
  求 i18n hint 写清楚。
- **Mosh 引用**：当前 `sshConnections` filter 是 `c.type === 'ssh'`，
  Mosh 不可见，所以天然不会出现 Mosh 被引用的情况。后端
  `X11DesktopConnect` 仍加一道 `if sshCfg.Type != "ssh"` 兜底（防
  止 store 中类型被改导致非法引用）。
- **本地 X server 多用户并发**：VcXsrv 同一时刻只能被一个用户会话
  持有——这是 OS 层面限制，不是本设计的问题。
- **首次发版无桌面崩溃保护**：如果桌面进程在 SSH 里被信号杀，本设
  计会干净退出。如果用户希望"自动重连"，那是后续 feature。

## 后续工作（不属本设计）

- 桌面会话内运行的 X 应用剪贴板与本机双向同步（已有 `xclip` /
  `xsel` 模式，需要后端 X11 event loop 支持 XFIXES / XSELN 扩展）
- 在 X11 desktop 期间临时关掉 / 重新打开 uniTerm 主窗口时本机 X
  server 的 keepalive
- 把 X11 desktop 卡片移到一个专门的"X11"侧边栏分类
- macOS 上 XQuartz 的 launchd 重启恢复
