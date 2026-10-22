# 项目技术依赖清单（国产化替代映射基础）

> 本文件由 team-leader 梳理，作为国产化替代评估的「现有技术」基线。
> 项目：uniTerm（原 uniTerm），跨平台终端管理桌面应用
> 代码规模：Go 后端 53,746 行 + Vue3/TS 前端 81,648 行 + 94 个 Vue 组件

## 一、Go 后端直接依赖

| 依赖 | 版本 | 用途 | 国产化替代关注点 |
|------|------|------|------------------|
| github.com/wailsapp/wails/v3 | v3.0.0-beta.16 | 桌面框架（WebView） | 🔴 无国产直接替代，依赖系统 WebView |
| golang.org/x/crypto | v0.53.0 | SSH/加密 | 🟡 可换国密 SM2/SM3/SM4 |
| github.com/pkg/sftp | v1.13.10 | SFTP | 🟡 |
| github.com/creack/pty | v1.1.24 | PTY 伪终端 | 🟢 底层系统调用 |
| github.com/UserExistsError/conpty | v0.1.4 | Windows ConPTY | 🟢 |
| github.com/go-sql-driver/mysql | v1.10.0 | MySQL 驱动 | 🟢 改驱动即可 |
| github.com/lib/pq | v1.12.3 | PostgreSQL 驱动 | 🟢 改驱动即可 |
| github.com/sijms/go-ora/v2 | v2.9.0 | Oracle 驱动 | 🟡 |
| github.com/microsoft/go-mssqldb | v1.10.0 | SQL Server 驱动 | 🟡 |
| github.com/redis/go-redis/v9 | v9.21.0 | Redis 客户端 | 🟢 协议兼容 |
| go.mongodb.org/mongo-driver | v1.17.9 | MongoDB 驱动 | 🟢 协议兼容 |
| github.com/rqlite/gorqlite | (pinned) | rqlite（分布式SQLite） | 🟢 |
| github.com/jlaffaye/ftp | v0.2.1 | FTP | 🟢 |
| github.com/cloudsoda/go-smb2 | (pinned) | SMB | 🟢 |
| github.com/studio-b12/gowebdav | v0.12.0 | WebDAV | 🟢 |
| github.com/rhnvrm/simples3 | v0.11.1 | S3 | 🟢 |
| github.com/go-git/go-git/v5 | v5.19.2 | Git 同步 | 🟢 |
| github.com/zalando/go-keyring | v0.2.8 | 凭据存储 | 🟡 国密加密 |
| github.com/unixshells/mosh-go | v0.5.2 | Mosh 协议 | 🟡 |
| go.bug.st/serial | v1.7.1 | 串口 | 🟢 |
| github.com/gorilla/websocket | v1.5.3 | WebSocket | 🟢 |
| github.com/kevinburke/ssh_config | v1.4.0 | SSH 配置解析 | 🟢 |
| github.com/mattn/go-ieproxy | v0.0.12 | 系统代理 | 🟢 |
| github.com/google/uuid | v1.6.0 | UUID | 🟢 |
| gopkg.in/yaml.v3 | v3.0.1 | YAML | 🟢 |
| golang.org/x/net | v0.56.0 | 网络 | 🟢 |
| golang.org/x/sync | v0.21.0 | 并发 | 🟢 |
| golang.org/x/sys | v0.46.0 | 系统调用 | 🟢 需适配龙芯/鲲鹏 |
| golang.org/x/text | v0.39.0 | 文本 | 🟢 |

## 二、前端生产依赖

| 依赖 | 版本 | 用途 | 国产化替代关注点 |
|------|------|------|------------------|
| vue | ^3.4.0 | 前端框架 | 🟡 ArkTS/国产框架 |
| element-plus | ^2.5.0 | UI 组件库 | 🟢 OpenTiny/TDesign |
| @element-plus/icons-vue | ^2.3.2 | 图标 | 🟢 |
| @xterm/xterm | ^6.0.0 | 终端模拟器 | 🔴 无成熟国产替代 |
| @xterm/addon-fit/search/unicode11/web-links | - | 终端插件 | 🔴 |
| codemirror + @codemirror/* | ^6.x | 代码编辑器 | 🟡 |
| @novnc/novnc | ^1.7.0 | VNC 远程桌面 | 🟡 |
| spice-html5-bower | 1.7.3 | SPICE 协议 | 🟡 |
| zmodem.js | ^0.1.10 | Zmodem 传输 | 🟢 |
| pinia | ^2.1.7 | 状态管理 | 🟢 |
| vue-virtual-scroller | ^2.0.0-beta.8 | 虚拟滚动 | 🟢 |
| js-yaml | ^5.2.1 | YAML | 🟢 |
| lz-string | ^1.5.0 | 压缩 | 🟢 |
| @lucide/vue | ^1.16.0 | 图标 | 🟢 |
| @fontsource-variable/* | - | 字体 | 🟢 |
| @wailsio/runtime | ^3.0.0-beta.16 | Wails 运行时 | 🔴 随框架绑定 |

## 三、技术分层框架（自底向上）

| 层 | 现有技术 | 国产化替代调研范围 |
|----|---------|-------------------|
| 芯片/指令集 | ARM64/x86 | 鲲鹏、飞腾、龙芯(LoongArch)、海光、兆芯 |
| 操作系统 | macOS/Windows/Linux | openEuler、统信UOS、麒麟Kylin、Deepin |
| 编程语言/运行时 | Go | 仓颉Cangjie、Rust、Go鲲鹏适配、Python |
| 编译器 | Go gc | 毕昇编译器、方舟编译器、仓颉编译器 |
| 桌面框架 | Wails v3 | Tauri、Qt、Flutter、Electron（无国产直接替代） |
| 前端框架 | Vue3 + ElementPlus | ArkUI/ArkTS、OpenTiny、TDesign |
| 终端模拟 | xterm.js | 自研、国产方案 |
| 数据库 | MySQL/PG/Oracle/MSSQL/Redis/MongoDB/ES | openGauss、GaussDB、TiDB、OceanBase、达梦、金仓、GBase、PolarDB、TDSQL、Tair |
| 中间件 | (无) | ShardingSphere、RocketMQ、Dubbo、ServiceComb、SkyWalking、Seata |
| 容器/K8s | Docker/K8s | iSula、KubeSphere、Volcano、KubeEdge |
| AI 框架/模型 | OpenAI/Anthropic/DeepSeek API | MindSpore、昇腾CANN、盘古、文心、GLM、通义 |
| 加密 | AES | 国密 SM2/SM3/SM4、铜锁Tongsuo、GmSSL |
| 凭据存储 | go-keyring | 国密加密 + 系统密钥环 |