# uniTerm 鸿蒙适配测试计划

## 1. 测试环境要求

### 1.1 必需环境
| 工具 | 版本要求 | 用途 |
|------|----------|------|
| DevEco Studio | 5.0.0+ | 鸿蒙工程编译、打包、调试 |
| HarmonyOS SDK | 5.0.0(12)+ | API 12+ |
| Go | 1.27+ | 交叉编译 Go 后端 |
| Node.js | 20+ | 前端构建 |
| hdc | 随 DevEco 安装 | 设备/模拟器连接 |

### 1.2 测试设备
- **模拟器**：HarmonyOS 5.0 ARM64 模拟器（DevEco Studio 内置）
- **真机**（可选）：HarmonyOS 5.0+ ARM64 设备（需开启开发者模式 + USB 调试）

### 1.3 环境检查
```bash
# 检查 hdc 是否可用
hdc list targets

# 检查 Go 交叉编译
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags server,production -o /tmp/test .

# 检查前端构建
cd frontend && npm run build
```

## 2. 测试阶段

### 阶段 1：Go 后端交叉编译验证（无需鸿蒙环境）
| 编号 | 测试项 | 预期结果 | 命令 |
|------|--------|----------|------|
| T1.1 | 交叉编译成功 | 产出 ELF ARM64 静态链接二进制 | `scripts/build-harmonyos.sh --skip-frontend` |
| T1.2 | 二进制格式验证 | `ELF 64-bit LSB executable, ARM aarch64, statically linked` | `file bin/uniTerm-harmonyos` |
| T1.3 | 二进制大小合理 | 40-60 MB | `ls -lh bin/uniTerm-harmonyos` |
| T1.4 | Go 测试通过 | 全部 PASS | `go test ./backend/...` |

### 阶段 2：Server 模式功能验证（在 macOS/Linux 上模拟）
| 编号 | 测试项 | 预期结果 | 命令 |
|------|--------|----------|------|
| T2.1 | Server 启动 | 监听 localhost:9245 | `AI_OPS_PORT=9245 ./uniTerm &` |
| T2.2 | 健康检查 | 返回 `{"status":"ok"}` | `curl http://localhost:9245/health` |
| T2.3 | 首页服务 | 返回嵌入的 index.html（含 /assets/ 引用） | `curl http://localhost:9245/` |
| T2.4 | 静态资源服务 | 返回 JS bundle | `curl http://localhost:9245/assets/index-*.js` |
| T2.5 | Wails 运行时 | 返回 JS 代码 | `curl http://localhost:9245/wails/custom.js` |
| T2.6 | 环境变量覆盖 | 监听指定端口 | `AI_OPS_PORT=9300 ./uniTerm & curl http://localhost:9300/health` |
| T2.7 | 优雅关闭 | 进程正常退出 | `kill -TERM <pid>` |

### 阶段 3：WebSocket 连通性验证（在 macOS/Linux 上模拟）
| 编号 | 测试项 | 预期结果 | 命令 |
|------|--------|----------|------|
| T3.1 | 事件 WebSocket 连接 | 连接成功 | `bash harmonyos/tests/websocket-test.sh` |
| T3.2 | 事件推送 | 收到事件消息 | 见 websocket-test.sh |
| T3.3 | Stream WebSocket 连接 | 连接成功 | 见 websocket-test.sh |

### 阶段 4：鸿蒙工程编译验证（需 DevEco Studio）
| 编号 | 测试项 | 预期结果 | 操作 |
|------|--------|----------|------|
| T4.1 | DevEco 打开工程 | 无报错 | DevEco Studio → Open → harmonyos/ |
| T4.2 | Sync 工程 | 同步成功 | DevEco → File → Sync and Refresh Project |
| T4.3 | Build HAP | 产出 .hap 文件 | DevEco → Build → Build Hap(s)/APP(s) |
| T4.4 | NDK 编译 | libnative_process.so 产出 | 检查 harmonyos/entry/build/.../libs/ |

### 阶段 5：鸿蒙设备/模拟器实测（需 DevEco + 设备）
| 编号 | 测试项 | 预期结果 | 操作 |
|------|--------|----------|------|
| T5.1 | 安装 HAP | 安装成功 | `hdc install entry-default-signed.hap` |
| T5.2 | 启动应用 | 显示加载页 | `hdc shell aa start -a EntryAbility -b com.aiops.terminal` |
| T5.3 | Go 子进程启动 | 进程列表中有 uniTerm | `hdc shell ps -ef \| grep ai-ops` |
| T5.4 | 健康检查通过 | 加载页消失，显示前端 UI | 观察 app 界面 |
| T5.5 | 前端 UI 渲染 | 显示完整终端界面（侧边栏+主区域） | 观察 app 界面 |
| T5.6 | WebSocket 事件 | 前端能收到后端事件 | 在 UI 中操作，观察响应 |
| T5.7 | 终端会话 | 能创建 SSH 终端并输入命令 | 在 UI 中新建 SSH 连接 |
| T5.8 | 文件对话框 | JSBridge 文件选择器弹出 | 在 UI 中触发文件操作 |
| T5.9 | 剪贴板 | JSBridge 剪贴板读写正常 | 在 UI 中复制/粘贴 |
| T5.10 | 应用退出 | Go 子进程同步退出 | `hdc shell ps -ef \| grep ai-ops`（无结果） |

### 阶段 6：崩溃恢复验证（需 DevEco + 设备）
| 编号 | 测试项 | 预期结果 | 操作 |
|------|--------|----------|------|
| T6.1 | 杀死 Go 子进程 | 应用自动重启 | `hdc shell kill -9 <pid>` |
| T6.2 | 多次崩溃 | 最多重启 3 次后显示错误页 | 连续 kill 3 次 |
| T6.3 | 应用退出时子进程清理 | 无残留进程 | 退出 app 后检查进程列表 |

## 3. 测试执行顺序

```
阶段 1（交叉编译）→ 阶段 2（Server 模式）→ 阶段 3（WebSocket）
    ↓ （需鸿蒙环境）
阶段 4（工程编译）→ 阶段 5（设备实测）→ 阶段 6（崩溃恢复）
```

- **阶段 1-3**：无需鸿蒙环境，可在 macOS/Linux 上执行
- **阶段 4-6**：需 DevEco Studio + 模拟器/真机

## 4. 已知限制

1. **无鸿蒙 SDK 环境**：当前开发机未安装 DevEco Studio / HarmonyOS SDK，阶段 4-6 暂无法执行
2. **NDK 编译**：native_process.c 需在鸿蒙 NDK 环境编译，本地仅通过语法检查
3. **ArkTS 编译**：.ets 文件需在 DevEco Studio 中编译验证，本地无法验证
4. **真机性能**：Go 二进制 47MB，在低端设备上可能启动较慢

## 5. 测试脚本

- `harmonyos/tests/websocket-test.sh` — WebSocket 连通性测试（阶段 3）
- `harmonyos/tests/e2e-test.md` — 端到端测试详细步骤（阶段 5-6）