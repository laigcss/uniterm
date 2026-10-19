/*
harmonyos/main.go - HarmonyOS c-shared 入口点

用纯 net/http + embed 启动 HTTP 服务器，不依赖 Wails。
编译为 c-shared 共享库 (libaiops.so)，作为 libaiops_native.so 的直接依赖链接。

关键设计：
  - main() 仅初始化 Go runtime，不启动服务器（因为环境变量尚未设置）
  - 导出 C 函数 StartServer(port) 供 NAPI 调用，在设置环境变量后启动服务器
  - 使用 initial-exec TLS 模型，必须在程序启动时加载（不能 dlopen）

不依赖 Wails，避免 CGO_ENABLED=1 时触发 GTK4/WebKitGTK 依赖。
现有 Mac/Windows/Linux 构建完全不受影响（本文件在独立子目录）。
*/

package main

/*
#include <stdint.h>
*/
import "C"

import (
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

// 前端静态资源（编译时嵌入 .so 文件）
//
//go:embed all:frontend/dist
var assets embed.FS

// serverReady 用于健康检查和导出状态
var serverReady = false

// serverOnce 确保服务器只启动一次
var serverOnce sync.Once

// serverStarted 标记服务器是否已启动
var serverStarted = false

//export IsServerReady
func IsServerReady() C.int {
	if serverReady {
		return 1
	}
	return 0
}

//export StartServer
func StartServer(port C.int) C.int {
	if serverStarted {
		log.Println("[uniTerm] 服务器已启动，跳过重复启动")
		return 0
	}

	host := os.Getenv("AI_OPS_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	portStr := fmt.Sprintf("%d", int(port))
	if portStr == "0" {
		portStr = os.Getenv("AI_OPS_PORT")
		if portStr == "" {
			portStr = "9245"
		}
	}
	addr := fmt.Sprintf("%s:%s", host, portStr)

	// 健康检查端点
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// 前端静态资源服务
	fs := http.FS(assets)
	fileServer := http.FileServer(fs)
	http.Handle("/", fileServer)

	log.Printf("[uniTerm] HTTP 服务器启动在 %s", addr)

	// 在 goroutine 中启动 HTTP 服务器
	go func() {
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Printf("[uniTerm] 服务器错误: %v", err)
		}
	}()

	// 标记服务器就绪
	serverStarted = true
	serverReady = true

	// 在 goroutine 中等待信号以保持 Go 运行时存活
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		log.Println("[uniTerm] 服务器关闭")
		serverReady = false
	}()

	return 0
}

func main() {
	// c-shared 模式：main.main 仅初始化 Go runtime，不启动服务器。
	// 服务器由导出的 C 函数 StartServer(port) 启动，
	// 该函数在 NAPI 模块设置环境变量后被调用。
	log.Println("[uniTerm] Go runtime 已初始化（c-shared 模式）")
}
