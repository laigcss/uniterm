//go:build cshared

// cshared.go — HarmonyOS c-shared 构建入口点。
//
// 编译为共享库 (libaiops.so)，作为 NAPI 模块 (libaiops_native.so) 的
// 直接依赖链接。Go runtime 在 NAPI 模块加载时自动初始化。
//
// 关键设计：
//   - main() 仅初始化 Go runtime，不启动服务器
//   - 导出 C 函数 StartServer(port) 供 NAPI 调用
//   - 使用 Wails server 模式，复用完整 App 后端（终端/SSH/k8s/容器等）
//   - server build tag 排除所有 GUI 依赖（GTK/WebKit 等），纯 net/http
//
// 编译命令：
//   CC="<ohos-clang> --target=aarch64-linux-ohos --sysroot=<sysroot>" \
//   GOOS=linux GOARCH=arm64 CGO_ENABLED=1 \
//   go build -buildmode=c-shared -tags server,cshared -o libaiops.so .
//
// 现有 Mac/Windows/Linux 桌面构建完全不受影响（!cshared tag 排除本文件）。

package main

/*
#include <stdint.h>
*/
import "C"

import (
	"embed"
	"fmt"
	"os"
	"sync"

	"github.com/ys-ll/uniterm/backend/log"
	"github.com/ys-ll/uniterm/backend/store"
	unisync "github.com/ys-ll/uniterm/backend/sync"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// 前端静态资源（编译时嵌入 .so 文件）
//
//go:embed all:frontend/dist
var assets embed.FS

var (
	csharedReady   = false
	csharedStarted = false
	csharedMu      sync.Mutex
)

//export IsServerReady
func IsServerReady() C.int {
	if csharedReady {
		return 1
	}
	return 0
}

//export SetDataDirRoot
func SetDataDirRoot(path *C.char) {
	root := C.GoString(path)
	store.DataDirRoot = root
	store.AutoInitMode = true
	log.LogDir = root
	unisync.SetKeychainDir(root)

	// 设置 HOME 和 XDG_CONFIG_HOME — Go 的 os.UserHomeDir()/os.UserConfigDir() 依赖这些
	// （C 的 setenv 在 c-shared 模式下对 Go 的 os.Getenv 不可见，必须在 Go 层设置）
	// 这修复了 SSH known_hosts 路径问题（os.UserHomeDir() 返回 /sdcard 导致权限拒绝）
	os.Setenv("HOME", root)
	os.Setenv("XDG_CONFIG_HOME", root)

	// 设置 PATH 包含鸿蒙系统目录，让本地终端和子进程能找到 sh 等命令
	oldPath := os.Getenv("PATH")
	harmonyPaths := "/system/bin:/system/xbin:/vendor/bin"
	if oldPath != "" {
		os.Setenv("PATH", oldPath+":"+harmonyPaths)
	} else {
		os.Setenv("PATH", harmonyPaths)
	}
}

//export StartServer
func StartServer(port C.int) C.int {
	csharedMu.Lock()
	defer csharedMu.Unlock()
	if csharedStarted {
		log.Writef("[cshared] 服务器已启动，跳过重复启动")
		return 0
	}

	// 在 Go 运行时中设置自动初始化标志 — 使用全局变量而非环境变量
	// （C 的 setenv 在 c-shared 模式下可能不被 Go 的 os.Getenv 看到）
	store.AutoInitMode = true
	os.Setenv("AI_OPS_AUTO_INIT", "1")

	log.Writef("[cshared] AutoInitMode=true, XDG_CONFIG_HOME=%s, HOME=%s", os.Getenv("XDG_CONFIG_HOME"), os.Getenv("HOME"))

	// 应用 server 模式配置（桥接 AI_OPS_HOST/PORT 到 WAILS_SERVER_HOST/PORT）
	serverModeConfig()

	// 初始化日志
	if err := log.Init(); err != nil {
		fmt.Printf("log.Init failed: %v\n", err)
	}

	// 创建 App 实例（包含完整后端：终端/SSH/k8s/容器/数据库等）
	app := NewApp("")

	// 确定端口
	portInt := int(port)
	if portInt == 0 {
		portInt = 9245
	}

	// 设置环境变量供 serverModeConfig 桥接
	if os.Getenv("AI_OPS_HOST") == "" {
		_ = os.Setenv("AI_OPS_HOST", "127.0.0.1")
	}
	if os.Getenv("AI_OPS_PORT") == "" {
		_ = os.Setenv("AI_OPS_PORT", fmt.Sprintf("%d", portInt))
	}

	log.Writef("[cshared] 启动 Wails server 模式，端口 %d", portInt)

	// 创建 Wails 应用（server 模式，无 GUI）
	w3app := application.New(application.Options{
		Name:       "uniTerm",
		Assets:     application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		OnShutdown: app.shutdown,
		Server: application.ServerOptions{
			Host:                     "127.0.0.1",
			Port:                     portInt,
			WebSocketAllowAllOrigins: true,
		},
	})

	// 关联 App 与 Wails 运行时
	app.app = w3app
	w3app.RegisterService(application.NewService(app))

	// 在 goroutine 中启动服务器（非阻塞）
	go func() {
		if err := w3app.Run(); err != nil {
			log.Writef("[cshared] Wails 运行错误: %v", err)
		}
	}()

	csharedStarted = true
	csharedReady = true
	return 0
}

func main() {
	// c-shared 模式：main.main 仅初始化 Go runtime。
	// 服务器由导出的 C 函数 StartServer(port) 启动，
	// 该函数在 NAPI 模块加载后被 ArkTS 调用。
	log.Writef("[cshared] Go runtime 已初始化（c-shared 模式）")
}
