// version.go — 应用版本号，所有构建模式共用。
//
// 从 main.go 中提取，以便 c-shared 构建模式（//go:build cshared）
// 可以排除 main.go 而仍然保留 Version 变量供 app.go 使用。
// ldflags 注入：-X main.Version=1.2.3

package main

var Version = "dev"
