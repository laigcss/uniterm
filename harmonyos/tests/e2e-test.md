# uniTerm 鸿蒙端到端测试指南

## 前置条件

1. **安装 DevEco Studio 5.0+**
2. **启动 HarmonyOS 模拟器**（DevEco → Tools → Device Manager → 创建/启动模拟器）
3. **交叉编译 Go 二进制**
   ```bash
   scripts/build-harmonyos.sh
   ```
4. **将 Go 二进制放入鸿蒙工程 rawfile**
   ```bash
   cp bin/uniTerm-harmonyos harmonyos/entry/src/main/resources/rawfile/uniTerm
   ```

## 测试步骤

### 步骤 1：编译鸿蒙工程

1. DevEco Studio → Open → 选择 `harmonyos/` 目录
2. File → Sync and Refresh Project
3. Build → Build Hap(s)/APP(s)
4. 确认产出：`harmonyos/entry/build/default/outputs/default/entry-default-signed.hap`

### 步骤 2：安装到模拟器

```bash
# 查找 HAP 文件
HAP=$(find harmonyos/entry/build -name "*.hap" | head -1)
echo "HAP: $HAP"

# 安装
hdc install "$HAP"
```

### 步骤 3：启动应用

```bash
# 启动 EntryAbility
hdc shell aa start -a EntryAbility -b com.aiops.terminal
```

**预期结果**：
- 应用启动，显示加载页"正在启动 uniTerm..."
- 5-10 秒后加载页消失，显示前端 UI

### 步骤 4：验证 Go 子进程

```bash
# 检查 Go 子进程是否运行
hdc shell ps -ef | grep uniTerm

# 预期输出包含：
# root  <pid>  ...  uniTerm
```

### 步骤 5：验证前端 UI

在模拟器中观察：
- [ ] 侧边栏显示（连接管理器、文件管理器等图标）
- [ ] 主区域显示（终端区域或欢迎页）
- [ ] AI 面板显示（右侧 AI 对话栏）
- [ ] 顶部工具栏显示

### 步骤 6：测试终端功能

1. 点击侧边栏"新建连接"
2. 输入 SSH 连接信息（主机、端口、用户名、密码）
3. 点击连接
4. **预期**：终端区域显示远程 shell 提示符
5. 输入命令 `ls -la`，确认输出显示
6. 输入命令 `exit`，确认终端会话关闭

### 步骤 7：测试 JSBridge 文件对话框

1. 在终端中右键 → "导出会话"
2. **预期**：鸿蒙原生文件保存对话框弹出
3. 选择保存位置，确认
4. **预期**：文件保存成功

### 步骤 8：测试 JSBridge 剪贴板

1. 在终端中选中文本，右键 → "复制"
2. 在其他应用中粘贴
3. **预期**：粘贴的文本与选中的文本一致
4. 从其他应用复制文本
5. 在终端中右键 → "粘贴"
6. **预期**：粘贴的文本输入到终端

### 步骤 9：测试 AI 面板

1. 点击右侧 AI 面板
2. 输入问题"帮我查看当前目录"
3. **预期**：AI 回复并可能执行 `ls` 命令
4. 确认 AI 响应在终端中显示结果

### 步骤 10：测试崩溃恢复

```bash
# 查找 Go 子进程 PID
PID=$(hdc shell ps -ef | grep uniTerm | grep -v grep | awk '{print $2}' | head -1)
echo "Go PID: $PID"

# 杀死 Go 子进程
hdc shell kill -9 $PID
```

**预期结果**：
- 应用界面短暂闪烁
- 显示"正在重启..."加载页
- 5 秒内恢复前端 UI
- Go 子进程重新启动

### 步骤 11：测试多次崩溃

```bash
# 连续杀死 3 次
for i in 1 2 3; do
    sleep 5
    PID=$(hdc shell ps -ef | grep uniTerm | grep -v grep | awk '{print $2}' | head -1)
    if [ -n "$PID" ]; then
        hdc shell kill -9 $PID
        echo "第 $i 次杀死 PID=$PID"
    fi
done
```

**预期结果**：
- 第 1-3 次崩溃后自动重启
- 第 4 次崩溃后显示错误页"后端进程多次崩溃，已停止自动重启"

### 步骤 12：测试应用退出

1. 按返回键或滑动退出应用
2. 等待 3 秒
3. 检查 Go 子进程

```bash
hdc shell ps -ef | grep uniTerm
# 预期：无输出（Go 子进程已随应用退出）
```

### 步骤 13：测试后台运行

1. 在应用中建立 SSH 连接
2. 按 Home 键将应用切到后台
3. 等待 10 秒
4. 切回前台

**预期结果**：
- SSH 连接保持
- 终端继续显示输出
- Go 子进程未中断

```bash
# 后台时检查进程
hdc shell ps -ef | grep uniTerm
# 预期：Go 子进程仍在运行
```

## 测试结果记录

| 步骤 | 测试项 | 结果 | 备注 |
|------|--------|------|------|
| 1 | 编译鸿蒙工程 | ⬜ | |
| 2 | 安装到模拟器 | ⬜ | |
| 3 | 启动应用 | ⬜ | |
| 4 | Go 子进程运行 | ⬜ | |
| 5 | 前端 UI 渲染 | ⬜ | |
| 6 | 终端功能 | ⬜ | |
| 7 | 文件对话框 | ⬜ | |
| 8 | 剪贴板 | ⬜ | |
| 9 | AI 面板 | ⬜ | |
| 10 | 崩溃恢复 | ⬜ | |
| 11 | 多次崩溃 | ⬜ | |
| 12 | 应用退出 | ⬜ | |
| 13 | 后台运行 | ⬜ | |

## 故障排查

### Go 子进程未启动
- 检查 rawfile 中是否有 Go 二进制
- 检查二进制是否有执行权限
- 查看 hilog：`hdc shell hilog | grep -E "IndexPage|NativeProcess"`

### 前端 UI 空白
- 检查 Go 服务器是否启动：`hdc shell curl http://localhost:9245/health`
- 检查 ArkWeb 是否加载：`hdc shell hilog | grep ArkWeb`
- 检查端口是否被占用：`hdc shell netstat -tlnp | grep 9245`

### WebSocket 连接失败
- 检查 Go 服务器日志：`hdc shell cat /data/storage/el2/base/files/uniTerm.log`
- 确认 WebSocketAllowAllOrigins 设置为 true

### JSBridge 不工作
- 检查 harmonyBridge 是否注册：在前端 console 中执行 `typeof window.harmonyBridge`
- 查看 hilog：`hdc shell hilog | grep JsBridge`