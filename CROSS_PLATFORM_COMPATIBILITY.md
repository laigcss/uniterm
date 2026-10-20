# 多端兼容性保障检查清单

> 本文档记录 uniTerm 在 Mac / Windows / Linux / HarmonyOS 四端共存时的兼容性保障措施。
> 每次修改代码后，请对照本清单检查是否引入了跨端兼容性问题。

---

## 1. Go 构建约束 (Build Tags)

### 1.1 项目自身文件

以下文件使用构建约束隔离平台特定代码：

| 文件 | 约束 | 说明 |
|------|------|------|
| `backend/session/keepalive_android.go` | `android && !server` | Android keepalive，server 模式排除 |
| `backend/session/keepalive_other.go` | `!android \|\| server` | 非 Android 或 server 模式 |
| `backend/store/bootstrap.go` | `!android \|\| server` | 桌面/server 启动逻辑 |
| `backend/store/bootstrap_android.go` | `android && !server` | Android 专属启动 |
| `backend/utils/tempdir_android.go` | `android && !server` | Android 临时目录 |
| `backend/utils/tempdir_other.go` | `!android \|\| server` | 非 Android 临时目录 |
| `backend/session/rdp_session.go` | `windows` | RDP 仅 Windows |
| `backend/session/rdp_session_stub.go` | `!windows` | 非 Windows RDP stub |

**规则**：
- 新增平台特定文件时，必须同时提供 `_other` 或 `_stub` 版本
- `server` 模式下，所有 GUI 相关代码必须被排除（`!server`）
- `server` 模式下，所有桌面 fallback 代码必须被包含（`|| server`）

### 1.2 Wails Vendor 文件（自动修补）

`go mod vendor` 会重置 vendor 目录中的构建约束。使用以下脚本自动恢复：

```bash
./scripts/apply-wails-build-constraints.sh          # 修补
./scripts/apply-wails-build-constraints.sh --check   # 仅检查（CI 用）
```

**修补范围**：
- 20 个 `*_android.go` 文件：`//go:build android` → `//go:build android && !server`
- 3 个 desktop/stub 文件：`//go:build !ios && !android` → `//go:build (!ios && !android) || server`

**何时运行**：
- 每次 `go mod vendor` 之后
- 每次 `go mod tidy` 触碰 vendor 之后
- 鸿蒙交叉编译之前
- CI 流水线中作为预检查

---

## 2. 前端兼容性

### 2.1 共享代码原则

前端代码（`frontend/src/`）在所有平台共享，**不做平台分支**。

- ✅ 正确：通过 API 能力检测决定功能可用性（如 `supportsOutputLog`）
- ❌ 错误：通过 `navigator.userAgent` 或硬编码平台判断

### 2.2 功能可用性条件

| 功能 | 条件 | 文件 |
|------|------|------|
| 会话输出日志（录屏） | 终端类型 ∈ {ssh, telnet, serial, mosh, local, wsl} | `BaseTerminal.vue`, `TabItem.vue` |
| RDP 远程桌面 | 仅 Windows 后端有完整实现 | `RDPTabContent.vue` |
| VNC 远程桌面 | 全平台 | `VNCTabContent.vue` |
| SPICE 远程桌面 | 全平台 | `SPICETabContent.vue` |

### 2.3 前端修改检查项

- [ ] 新增组件不包含平台硬编码判断
- [ ] 新增 API 调用有对应的 Go 方法且在所有平台可编译
- [ ] `favoriteStore.ts` 等状态管理使用防御性检查（`Array.isArray` 等）
- [ ] CSS 不使用平台专属属性（如 `-webkit-` 前缀需配合 `@supports`）

---

## 3. 鸿蒙端 (HarmonyOS) 专属检查

### 3.1 构建流程

```bash
# 完整构建
./scripts/build-harmonyos.sh

# 构建并部署到设备
./scripts/build-harmonyos.sh --deploy

# 仅检查约束
./scripts/build-harmonyos.sh --check-only
```

### 3.2 关键约束

| 约束 | 说明 |
|------|------|
| `GOOS=android` | **不是** `GOOS=linux`，确保 TLS 模型兼容 NAPI dlopen |
| `GOARCH=arm64` | 鸿蒙模拟器和真机均为 arm64 |
| `-tags server,cshared` | server 模式 + c-shared 库 |
| `-mod=vendor` | 使用 vendor 模式，避免网络依赖 |
| `CGO_ENABLED=1` | c-shared 必须启用 CGO |

### 3.3 鸿蒙端文件

| 文件 | 作用 |
|------|------|
| `harmonyos/entry/src/main/cpp/CMakeLists.txt` | 链接 libaiops.so |
| `harmonyos/entry/src/main/ets/pages/Index.ets` | startServer 启动流程 |
| `harmonyos/entry/src/main/cpp/native_process.c` | NAPI 桥接层 |
| `harmonyos/entry/libs/arm64-v8a/liblog.so` | stub Android liblog |
| `cshared.go` | Go c-shared 入口点 |

### 3.4 已知限制

- RDP 远程桌面：鸿蒙端为 stub（`rdp_session_stub.go`），Connect 返回错误
- 录屏功能：通过右键菜单访问，条件同其他平台
- `go mod vendor` 会覆盖 Wails vendor 构建约束，需运行修补脚本

---

## 4. CI 检查集成建议

在 CI 流水线中添加以下检查步骤：

```yaml
# 示例：GitHub Actions
- name: Verify build constraints
  run: ./scripts/apply-wails-build-constraints.sh --check

- name: Build (Mac)
  run: task build

- name: Build server mode
  run: task build:server

- name: Build HarmonyOS (cross-compile only)
  run: ./scripts/build-harmonyos.sh --skip-frontend --check-only
```

---

## 5. 变更检查流程

每次提交代码前，确认：

1. **Go 文件**：新增平台特定文件时，检查构建约束是否正确
2. **前端文件**：确认不引入平台硬编码判断
3. **Vendor 文件**：如执行了 `go mod vendor`，运行修补脚本
4. **鸿蒙文件**：如修改了 `harmonyos/` 下的文件，确认不影响其他平台
5. **构建脚本**：如修改了构建流程，更新本清单

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-10-20 | 初始创建：Wails vendor 构建约束自动修补脚本、鸿蒙构建脚本、兼容性检查清单 |