# 国产化替代评估报告（uniTerm / 原 uniTerm）

> **文档性质**：国产化（信创）替代可行性评估汇总报告
> **评估对象**：uniTerm（原 uniTerm）跨平台 AI 运维终端管理桌面应用
> **汇总编写**：国产化替代评估报告汇总编写员（task 43）
> **数据来源**：`research/00`～`research/04` 五份调研文件（全部已读取）
> **编写日期**：2026-10-12
> **严谨性声明**：本报告汇总自五份独立调研，所有结论附来源；无法核实的明确标注「未能核实」；严格区分官方宣传与实际生产可用；不凭空捏造技术、版本号、库名、URL。

---

## 1. 摘要与结论速览（TL;DR）

### 1.1 一段话总结

uniTerm 是一款基于 Wails v3 + Go + Vue 3 + Element Plus + xterm.js 的跨平台桌面运维终端工具（Go 后端 53,746 行 + Vue3/TS 前端 81,648 行）。经全栈逐层评估，**最务实、可信、低成本的国产化落地方向是「CPU 多架构构建 + 国产 OS（openEuler/麒麟/deepin）适配 + 数据库驱动替换 + 对象存储迁移至 S3 兼容国产云存储」**，这些方向项目已有基础（已专门为 Kylin V10/RHEL 8/openEuler 构建独立包）且改动集中在构建链与配置层。**中等可行的是「国密加密（AES-GCM → SM4-GCM）替换 + 国产数据库 PoC」**，需工程化处理版本兼容但路径清晰。**仓颉语言替代 Go 后端当前不具备现实可行性**（SSH/SFTP/终端解析/MongoDB/ES 等关键库缺失，属长期观察项）；**ArkTS/ArkUI 仅适合"HarmonyOS 专用版"**（需重写 8.2 万行前端且失去跨平台能力）。多数服务端中间件（ShardingSphere/Dubbo/ServiceComb/ShenYu/Seata）对桌面终端工具属**过度设计**，不建议引入。

### 1.2 技术分层替代可行性排序速览表（从易到难）

| 排序 | 技术层 | 首选国产替代 | 可信性（国产替代方案） | 迁移成本 | 一句话结论 |
|:---:|--------|-------------|:------:|:--------:|-----------|
| 1 | 芯片/指令集 | 鲲鹏(arm64)/海光(x86)/龙芯(loong64) | 可信 | 低 | CI 增加目标架构构建即可，无源码改动 |
| 2 | 操作系统 | openEuler / 麒麟 V10 / deepin | 可信 | 低 | 项目已有 webkit40 适配构建 |
| 3 | 对象存储 | 华为 OBS / 阿里 OSS / 腾讯 COS | 可信 | 低 | S3 协议兼容，改 endpoint 即可 |
| 4 | 数据库(MySQL) | TiDB / OceanBase(MySQL) / TDSQL | 可信 | 低 | 协议兼容，改 DSN 即可 |
| 5 | 数据库(Redis) | 阿里云 Tair / 腾讯云 Tair | 可信 | 低 | RESP 兼容，改连接串即可 |
| 6 | 数据库(ES) | Easysearch / 腾讯云 ES | 可信 | 低 | REST 通用，改 baseUrl 即可 |
| 7 | 容器引擎 | iSulad（需适配 CLI） | 可信 | 中 | 需开发 isula CLI 适配层 |
| 8 | K8s 增强 | KubeSphere / KubeEdge / Volcano | 可信 | 中 | REST API 兼容，可直连 |
| 9 | 加密(本地) | SM4-GCM（tjfoc/gmsm） | 可信 | 中 | 需版本化+双读兼容 |
| 10 | 数据库(PG) | openGauss / KingbaseES | 有条件可信 | 中 | 需换官方 fork 驱动 |
| 11 | 数据库(MongoDB) | SequoiaDB | 有条件可信 | 中 | 协议兼容待实测 |
| 12 | 数据库(Oracle) | 达梦 DM / OceanBase(Oracle) | 有条件可信 | 高 | 需重写模块+SQL 方言适配 |
| 13 | AI 框架 | MindSpore / 昇腾 | 有条件可信 | 高 | 现有云端 API 路径更实用，属可选增强 |
| 14 | 前端框架/UI | ArkUI/ArkTS / OpenTiny | 有条件可信 | 高 | 需重写 94 组件，仅限 HarmonyOS 专用版 |
| 15 | 桌面框架 | 无国产直接替代（保持 Wails） | 有条件可信 | 高 | 换 Tauri 不解决根因；Electron/Qt 需重写 |
| 16 | 终端模拟 | 无成熟国产替代（保持 xterm.js） | 不可信 | 不可行 | xterm.js 为纯前端，无国产化压力 |
| 17 | SSH 国密化 | 国密 SSH（无标准化依据） | 不可信 | 高 | 缺乏标准化一手依据，独立课题 |
| 18 | 编程语言 | 仓颉 Cangjie | 有条件可信 | 不可行 | 关键库缺失，长期观察项 |

---

## 2. 项目概况与技术栈基线

### 2.1 基本信息

| 项 | 值 |
|----|----|
| 项目名称 | uniTerm（原 uniTerm） |
| 定位 | 跨平台 AI 运维终端管理桌面应用 |
| Go 后端代码规模 | 53,746 行 |
| Vue3/TS 前端代码规模 | 81,648 行 |
| Vue 组件数量 | 94 个 |
| 技术栈 | Wails v3 + Go + Vue 3 + Element Plus + xterm.js |
| Go module | `github.com/ys-ll/uniterm`，Go 1.26.2 |
| 桌面框架 | Wails v3.0.0-beta.16（Go + 系统 WebView） |
| 前端运行时 | @wailsio/runtime ^3.0.0-beta.16 |

> 来源：`research/00-project-deps.md`；`research/03-domestic-middleware.md` §2.1

### 2.2 关键实现事实（评估基础，必须写明）

以下事实直接来自项目源码核实，是本评估的基础前提：

1. **K8s 模块是手写 HTTP/REST 客户端**，`go.mod` 中无 `k8s.io/client-go` 依赖。`backend/k8s/client.go` 基于 `net/http` 自研 REST 客户端，自研 Kubeconfig 解析，自定义 RoundTripper 注入 token/cert。**影响**：任何兼容 K8s REST API 的发行版/平台均可直连，无需引入 client-go。

2. **容器模块是 CLI 命令调用**（`os/exec`），非 Docker SDK。`backend/container/runner_local.go` 通过 `os/exec` 调用容器引擎 CLI，`provider.go` 的 Runtime 枚举含 **docker / podman / nerdctl / WSLC**。**影响**：项目已天然支持 podman 和 nerdctl（containerd），替换 Docker 只需目标机有兼容 CLI。

3. **ES 是自研 net/http REST 客户端**。`backend/session/elasticsearch_session.go` 的 import 中仅 `net/http`、`encoding/json`，无第三方 ES 客户端。**影响**：迁移到 ES 兼容产品只需改 baseUrl/鉴权。

4. **加密用 AES-256-GCM**。`backend/credentials/crypto.go`（凭据字段级加密，密文前缀 `enc:v1:`）+ `backend/sync/crypto.go`（云同步文件加密，带 AAD）+ `backend/sync/keychain.go`（PBKDF2-SHA256，600000 迭代派生密钥）。第三方导入器 `backend/importer/*` 的 AES-CBC 用于兼容 Navicat/WindTerm/DBeaver 私有格式，不可替换。

5. **项目已有国产 OS 适配**。`.github/workflows/build-linux-webkit40.yml` 面向 Kylin V10 / RHEL 8 / openEuler 构建，在 Rocky Linux 8 容器中编译，链接 webkit2gtk-4.0（不带 `-tags webkit2_40`），以兼容国产旧版仓库缺少 WebKit ≥ 2.40 的情况。**这是本项目信创可行性的最强证据。**

6. **数据库采用 provider 插件式架构**。`backend/database/provider.go` 定义统一 `Provider` 接口，每种数据库通过 `provider_*.go` 实现。**影响**：协议兼容的替代只需新增/复用 provider + 改驱动；协议不兼容的需完整实现新 provider。

7. **云同步模块是 Git 仓库同步**（`go-git/v5`），与消息中间件无关。对象存储通过 `backend/session/s3_session.go`（`simples3`，S3 协议）对接。

> 来源：`research/03-domestic-middleware.md` §2.2-2.4；`research/04-xinchuang-adaptation.md` §1.6、§4.5；`research/02-domestic-database.md` §1

---

## 3. 逐层评估

> 评级约定：
> - **可信性等级**：可信 / 有条件可信 / 不可信（或暂无法评估）
> - **迁移成本**：低 / 中 / 高 / 不可行
> - **成熟度**：生产级 / 成熟中 / 早期 / 未能核实

### 3.1 芯片/指令集层

| 项 | 内容 |
|----|------|
| 现有技术 | x86_64 / ARM64（macOS/Windows/Linux 主流架构） |
| 国产替代 | 鲲鹏 920（ARMv8）、飞腾腾锐/腾云（ARM）、龙芯 3A6000/3C6000（LoongArch 自主指令集）、海光（x86 生态）、兆芯开先/开胜（x86 生态） |
| 成熟度 | 生产级（党政/金融/运营商批量交付） |
| 可信性等级 | 可信（产品线真实、有出货；部分厂商官网参数未能取证，不臆断制程/主频） |
| 迁移成本 | 低（x86_64 原生零改动；arm64 Go 官方支持；loong64 Go 已支持，需单独构建+测试） |

**评估要点**：
- **x86_64（海光、兆芯）**：Go/Rust/Python 官方工具链原生支持，无迁移障碍。
- **ARM64（鲲鹏、飞腾）**：Go 官方支持 `linux/arm64`，构建/性能需验证但生态成熟。
- **LoongArch（龙芯）**：Go 官方下载页包含 `loong64` 目标（实测在 `golang.google.cn/dl` 页面出现），说明 Go 已支持龙芯架构；需单独构建与充分测试（尤其第三方 Go 依赖的纯净度）。
- **主要障碍**：龙芯 LoongArch 需单独构建与充分测试；ARM 平台性能/驱动适配；分发渠道与签名。

> 来源：`research/01-huawei-base-tech.md` §4（鲲鹏社区官网 https://www.hikunpeng.com ；飞腾 https://www.phytium.com.cn/ ；龙芯 https://www.loongson.cn ；海光 https://www.hygon.cn ；兆芯 https://www.zhaoxin.com ；Go 官方下载页 https://golang.google.cn/dl/ ）

### 3.2 操作系统层

| 项 | 内容 |
|----|------|
| 现有技术 | macOS / Windows / Linux |
| 国产替代 | openEuler（26.09 创新版 / 24.03 LTS SP4）、银河麒麟 V10/V11、openKylin 3.0、deepin 25、统信 UOS |
| 成熟度 | 生产级（麒麟/deepin/openKylin 桌面成熟；openEuler 服务器强、桌面中；UOS 专业版资料缺失） |
| 可信性等级 | 可信（麒麟/deepin/openKylin 已取证）；有条件可信（UOS 官网不可达，专业版未直接验证；openEuler 桌面非主战场） |
| 迁移成本 | 低（项目已有 Linux webkit40 适配构建） |

**评估要点**：
- **openEuler**：最新社区版 26.09（2026-09-30 发布），24.03 LTS SP4（2026-06-30 发布），支持 x86_64/aarch64/ARM32/RISC-V/LoongArch/PowerPC/SW-64，木兰宽松许可证 v2。Wails（Go）应用迁到 openEuler 技术障碍较小。
- **银河麒麟 V11**：基于全新内核，采用磐石架构（不可变系统）与开明包格式，同源支持国内外主流处理器架构。**注意**：开明包格式对传统 deb/tar.xz 安装包的影响未能取得一手资料，需在目标环境实测。
- **deepin 25**：最新镜像 25.2.0，桌面环境 DDE，基于 Debian 系，WebKitGTK 可获得。
- **openKylin 3.0**：开源社区版，桌面环境 UKUI，提供兼容适配规范/列表/申请。
- **统信 UOS**：家庭版 V22.0 可访问，专业版/服务器版官网超时不可达，具体版本号与 WebView 组件版本未能核实。
- **核心难点**：Wails 在 Linux 上依赖系统 WebKitGTK（webkit2gtk-4.0），国产旧版仓库（麒麟 V10）常缺少 WebKit ≥ 2.40，需按 4.0 ABI 链接。项目已处理此问题。

> 来源：`research/01-huawei-base-tech.md` §3；`research/04-xinchuang-adaptation.md` §1（openEuler https://www.openeuler.org/zh/ ；麒麟 https://www.kylinos.cn/ ；openKylin https://www.openkylin.top/ ；deepin https://www.deepin.org/index/zh ；UOS 家庭版 https://home.uniontech.com/ ）

### 3.3 编程语言层（仓颉 Cangjie vs Go）

| 项 | 内容 |
|----|------|
| 现有技术 | Go 1.26.2（后端 53,746 行） |
| 国产替代 | 仓颉 Cangjie（STS 1.2.0 / LTS 1.0.5，已开源 Apache-2.0） |
| 成熟度 | 早期→成熟中（语言/编译器/运行时/标准库 1.0 可用；鸿蒙版仍"内测及试点商用"；三方生态有限） |
| 可信性等级 | 有条件可信（语言真实存在、可下载、已开源，非纯宣传；但"全场景/高性能/原生智能化"属宣传话术，实际落地以鸿蒙应用为主，桌面应用生态几乎空白） |
| 迁移成本 | 不可行（核心协议库缺失，只能靠 FFI 调 C 库或从零自研） |

**评估要点**：
- 仓颉官方定位"面向全场景智能的新一代编程语言"，提供 LTS/STS/Nightly 三通道，支持 Linux/Windows/macOS，配套 VS Code 插件、CodeArts IDE for Cangjie、J2CJ 转换工具。
- **三方生态（Cangjie-TPC）已有**：redis-sdk（兼容 Jedis 语义）、opengauss-driver、mysqlclient-ffi（FFI）、OBS Cangjie SDK、crypto-ffi、net4cj（FTP/Telnet）等。
- **生态缺口（对本项目至关重要，实测清单中未出现）**：
  - ❌ SSH / SFTP / SCP 客户端（无任何仓颉库）——终端应用最核心的协议无法直接覆盖
  - ❌ VNC / RDP 远程桌面
  - ❌ 终端 PTY + VT/ANSI 转义序列解析（终端模拟核心）
  - ❌ MongoDB 驱动、Elasticsearch 客户端
  - ❌ Docker / Kubernetes 客户端（可通过 HTTP REST 自研绕过）
- **结论**：仓颉不能作为本项目后端替代的现成方案，最多作为长期（3-5 年）观察项。

> 来源：`research/01-huawei-base-tech.md` §1（仓颉官网 https://cangjie-lang.cn ；GitCode Cangjie 组织 https://gitcode.com/Cangjie ；TPC-Resource https://gitcode.com/Cangjie-TPC/TPC-Resource ）

### 3.4 编译器层（毕昇/方舟 vs Go gc）

| 项 | 内容 |
|----|------|
| 现有技术 | Go gc（Go 官方编译器） |
| 国产替代 | 毕昇 JDK（OpenJDK 定制版）、毕昇 C/C++ 编译器（未能核实）、方舟编译器（ArkCompiler）、仓颉编译器（基于 LLVM） |
| 成熟度 | 毕昇 JDK：成熟中→生产级；方舟编译器：生产级（仅限 OpenHarmony 生态）；毕昇 C/C++：未能核实 |
| 可信性等级 | 毕昇 JDK 可信；方舟编译器限定语境可信（通用编译器说法不可信）；毕昇 C/C++ 未能核实 |
| 迁移成本 | 不适用（本项目后端为 Go、前端为 Vue/TS，不使用 JDK，也不使用 C/C++ 编译器） |

**评估要点**：
- **毕昇 JDK**：华为内部 OpenJDK 定制版 Huawei JDK，支持 Linux/AArch64、Linux/x86_64，在 ARM 架构上进行了性能优化，可用于生产环境。**与本项目几乎无关**（项目非 Java）。
- **方舟编译器**：当前公开能力集中在 ArkTS/JS 的运行时与前端编译，未证实可用于通用 C/C++/Java 的编译。网上"方舟编译器全面开源替代 GCC/LLVM"的说法**缺乏证据支持，属夸大宣传**。
- **仓颉编译器**：基于 LLVM（`llvm-project` fork）。
- **关联度**：低。仅在仓颉方案下才会用到仓颉编译器。

> 来源：`research/01-huawei-base-tech.md` §5（Gitee openEuler/bishengjdk-8 https://gitee.com/openeuler/bishengjdk-8 ；GitCode arkcompiler_runtime_core https://gitcode.com/openharmony/arkcompiler_runtime_core ）

### 3.5 桌面框架层（Wails v3 vs Tauri/Electron/Qt/Flutter）

| 项 | 内容 |
|----|------|
| 现有技术 | Wails v3.0.0-beta.16（Go + 系统 WebView） |
| 国产替代 | 无国产直接替代；备选 Tauri 2（Rust，同为系统 WebView）、Electron（自带 Chromium）、Qt（自绘/信创主流）、Flutter（自绘/鸿蒙） |
| 成熟度 | Wails：成熟中（beta）；Tauri 2：成熟中；Electron/Qt：生产级；Flutter：生产级 |
| 可信性等级 | 有条件可信（Wails 在国产 OS 可行但需处理 WebKitGTK 版本，项目已处理） |
| 迁移成本 | Wails 保持：低；Electron：中（前端几乎零改，但体积大）；Qt：高（需重写前端）；Tauri：中（不解决根因） |

**评估要点**：
- **Wails v3（保持，首选）**：本身不是国产框架，也不应期待有"国产 Wails 替代品"。项目已专门为国产 OS 处理 WebKitGTK 4.0 ABI 适配，改动最小。
- **Tauri 2（不推荐）**：与 Wails 架构同源，同样使用系统 WebView，换成 Tauri 不能规避 WebView 依赖问题，只是把 Go 换成 Rust。
- **Electron（次选）**：内嵌 Chromium，不依赖系统 WebView，国产 OS 兼容性主要取决于 glibc/库版本。前端代码几乎零改，但体积大、内存高，与 Wails 的"轻量"定位相悖。
- **Qt（备选）**：自带渲染，不依赖系统 WebView，信创行业事实上的主流桌面技术栈。代价是需用 C++/QML 重写前端，无法复用现有 Vue 3 代码。
- **Flutter（备选）**：自绘引擎，不依赖系统 WebView，无法复用 Vue 前端，国内鸿蒙版本由 OpenHarmony 社区/华为维护。
- **是否存在"纯国产桌面框架"**：未能核实。国内多为基于既有框架的发行版/适配层，而非全新自研框架。

> 来源：`research/04-xinchuang-adaptation.md` §2（Tauri https://v2.tauri.app/ ；Qt https://www.qt.io/ ）

### 3.6 前端框架与UI组件层（Vue3+ElementPlus vs ArkUI/ArkTS/OpenTiny）

| 项 | 内容 |
|----|------|
| 现有技术 | Vue 3.4 + Element Plus 2.5 + TypeScript |
| 国产替代 | ArkUI/ArkTS（OpenHarmony 默认开发语言与框架）、OpenTiny/tiny-vue（Vue 2/3 国产 UI 组件库） |
| 成熟度 | ArkUI/ArkTS：生产级（移动/物联网 UI）；OpenTiny：生产级 |
| 可信性等级 | ArkUI/ArkTS：可信（移动域），但作为桌面替代属过度延展；OpenTiny：可信 |
| 迁移成本 | ArkUI/ArkTS：高（需重写 94 个组件，仅能运行于 HarmonyOS/OpenHarmony）；OpenTiny：中（API 差异大，需逐组件迁移） |

**评估要点**：
- **ArkTS**：OpenHarmony 应用的默认开发语言，在 TypeScript 生态基础上做了扩展（强制静态类型、禁止运行时改变对象布局、限制运算符语义）。自 API version 10 起强化静态检查。语言层迁移成本相对可控（基于 TS）。
- **ArkUI**：基于 ArkTS 的声明式开发范式方舟开发框架，覆盖布局/组件/路由/动画/交互。**但需重写全部 94 个组件，且仅能运行于 HarmonyOS/OpenHarmony，无法覆盖 macOS/Windows/Linux**。
- **OpenTiny/tiny-vue**：跨端、跨框架企业级 UI 组件库，支持 Vue 2 和 Vue 3，PC 端和移动端。是唯一可核实的、可几乎同构替换 Element Plus 的国产库。
- **重要提示**：Element Plus 是纯前端 npm 包，不涉及"是否国产"的运行风险；UI 组件库替换的主要动机是"信创形象/合规"而非技术必需。替换收益有限、回归风险高，**建议非必要不换**。
- **不匹配方案**：Ant Design / Semi Design 为 React 库，Arco Design 主体为 React，与本项目 Vue 3 技术栈不匹配，替换等于换框架，成本极高。TDesign（腾讯）官网超时未能核实。

> 来源：`research/01-huawei-base-tech.md` §2（OpenHarmony docs https://gitcode.com/openharmony/docs ）；`research/04-xinchuang-adaptation.md` §3（OpenTiny https://gitee.com/opentiny/tiny-vue ；Arco https://arco.design/ ；Semi https://semi.design/ ）

### 3.7 终端模拟层（xterm.js 国产化可行性）

| 项 | 内容 |
|----|------|
| 现有技术 | @xterm/xterm ^6.0.0 + addon-fit/search/unicode11/web-links |
| 国产替代 | 无成熟国产替代 |
| 成熟度 | xterm.js：生产级（纯前端 JS 库） |
| 可信性等级 | 可信（xterm.js 本身无国产化压力，为纯前端 npm 包） |
| 迁移成本 | 无（保持现状） |

**评估要点**：
- xterm.js 是纯前端 JavaScript 终端模拟器，不涉及运行时国产化风险。
- 仓颉生态中**缺失终端 PTY + VT/ANSI 转义序列解析**库，若用仓颉重写后端则终端模拟核心需从零自研。
- 在 WebKitGTK 上，xterm.js 等高交互前端组件对 JS/GPU 性能敏感；缺少 GPU 驱动/硬件加速时可能回退软件渲染，终端大数据量渲染性能下降。

> 来源：`research/00-project-deps.md`；`research/01-huawei-base-tech.md` §1.4；`research/04-xinchuang-adaptation.md` §1.6

**浏览器内核 / WebView 层补充说明**：国产安全浏览器（红莲花、360 安全浏览器、奇安信可信浏览器、华为 ArkWeb）多采用 Chromium 系内核 + 安全加固模块，属于"外国开源内核 + 国产加固"，并非完全自研内核。**桌面应用（Wails）使用的是系统 WebKitGTK，而非这些浏览器内核**，两者不是同一层次，不构成直接替代关系。若未来希望"应用内嵌国产安全内核"，理论路径是内嵌 Chromium/CEF 并替换为国产加固版，但是否有可商用的桌面 WebView 国产内核**未能核实**。

> 来源：`research/04-xinchuang-adaptation.md` §7

### 3.8 数据库层（MySQL/PG/Oracle/MSSQL/Redis/MongoDB/ES → 国产替代）

| 数据库 | Go 驱动 | 协议 | 首选国产替代 | 协议兼容 | 成熟度 | 可信性 | 迁移成本 |
|--------|---------|------|-------------|:--------:|--------|:------:|:--------:|
| MySQL | go-sql-driver/mysql v1.10.0 | MySQL wire | **TiDB** | ✅ | 生产级 | 可信 | 低（改 DSN） |
| PostgreSQL | lib/pq v1.12.3 | PG wire | **openGauss** | 🟡 | 生产级 | 有条件可信 | 中（换驱动） |
| Oracle | sijms/go-ora/v2 v2.9.0 | Oracle TNS | **达梦 DM** | 🟡 | 生产级 | 有条件可信 | 高（重写模块+方言） |
| SQL Server | go-mssqldb v1.10.0 | TDS | 无直接对应 | ❌ | — | — | 高 |
| Redis | go-redis/v9 v9.21.0 | RESP | **阿里云 Tair / 腾讯云 Tair** | ✅ | 生产级 | 可信 | 低 |
| MongoDB | mongo-driver v1.17.9 | MongoDB wire | **SequoiaDB** | 🟡 | 成熟中 | 有条件可信 | 低~中（待实测） |
| Elasticsearch | 自研 net/http REST | ES REST | **Easysearch** | ✅ | 成熟中 | 可信 | 低（改 baseUrl） |
| rqlite | gorqlite | HTTP+SQLite | — | — | — | — | — |

**评估要点**：
- **MySQL 模块替换成本最低**：TiDB / OceanBase(MySQL 模式) / TDSQL / PolarDB(MySQL) 均兼容 MySQL 协议，Go 驱动 `go-sql-driver/mysql` 无需更换，只需改 DSN。
- **PG 模块**：openGauss 需换成官方 Go 驱动 fork `openGauss-connector-go-pq`（基于 libpq 修改，适配 SHA256/SM3 认证）；KingbaseES / GBase 8c / PolarDB(PG) 可试 `lib/pq`。
- **Oracle 模块替换成本最高**：达梦、OceanBase Oracle 模式均不兼容 Oracle 的 SQL\*Net 协议，必须替换驱动并做 SQL 方言适配，"改驱动 + 重写 SQL 方言"量级。
- **Redis / MongoDB / ES 模块**（云上）可平滑替换：Tair 兼容 Redis（RESP），SequoiaDB 定位 MongoDB 国产化替换（协议待实测），Easysearch 兼容 ES 索引至 6.x。
- **备选**：OceanBase(MySQL)、TDSQL、PolarDB(MySQL/PG)、GBase 8s/8c、腾讯云 ES、华为 GaussDB/GeminiDB/CloudSearch（商用，未能核实）。
- **关键洞察**：项目采用 provider 插件式架构，协议兼容的替代只需新增/复用 provider + 改驱动；协议不兼容的需完整实现新 provider（对标现有 `provider_oracle.go` 的 678 行规模）。

> 来源：`research/02-domestic-database.md` 全文（openGauss https://www.opengauss.org/zh/ ；TiDB https://docs.pingcap.com/zh/tidb/stable/overview ；OceanBase https://www.oceanbase.com/ ；达梦 https://www.dameng.com/ ；金仓 https://www.kingbase.com.cn/ ；GBase https://www.gbase.cn/product/gbase-8c ；PolarDB https://www.aliyun.com/product/polardb ；TDSQL https://cloud.tencent.com/product/tdsql ；Tair https://www.aliyun.com/product/redis ；SequoiaDB http://www.sequoiadb.com/ ；Easysearch https://www.easysearch.cn/ ）

### 3.9 中间件层（ShardingSphere/RocketMQ/Dubbo/ServiceComb/SkyWalking/Seata/ShenYu）

| 中间件 | 类别 | 成熟度 | 与本项目关联度 | 国产? | 可信性 | 迁移成本 |
|--------|------|--------|----------------|:-----:|:------:|:--------:|
| Apache ShardingSphere | 分布式 SQL 引擎 | 生产级 | **无关联/过度设计** | 是 | 可信 | 不适用 |
| Apache RocketMQ | 消息队列 | 生产级 | 可增强（间接）/过度设计 | 是 | 可信 | 不适用 |
| Apache Dubbo | 微服务 RPC | 生产级 | **无关联/过度设计** | 是 | 可信 | 不适用 |
| Apache ServiceComb | 微服务框架 | 生产级 | **无关联/过度设计** | 是 | 有条件可信 | 不适用 |
| Apache SkyWalking | 可观测性 APM | 生产级 | 可增强（直接，Go agent） | 是 | 可信 | 中（可选增强） |
| Apache Seata | 分布式事务 | 成熟中 | **无关联/过度设计** | 是 | 有条件可信 | 不适用 |
| Apache ShenYu | API 网关 | 生产级 | **无关联/过度设计** | 是 | 有条件可信 | 不适用 |

**评估要点**：
- **核心结论：服务端中间件对桌面终端工具属过度设计。** 本项目是桌面端 AI 运维终端工具（Wails v3 + Go + Vue3），定位为运维人员的本地/远程操作工具，而非服务端分布式系统。ShardingSphere、Dubbo、ServiceComb、ShenYu、Seata 解决的是服务端分布式系统的数据分片、RPC、API 网关、分布式事务等问题，本项目不涉及这些场景。
- **强行引入属过度设计**：会增加不必要的复杂度和依赖，违背桌面工具轻量化原则。
- **间接价值有限**：仅在"本项目运维的目标集群使用了这些中间件"时才有运维观察价值——但这是运维对象，而非本项目自身需集成的组件。
- **SkyWalking** 有 Go agent，理论上可集成上报运维操作链路，但桌面工具而非服务端应用，APM 集成价值有限——更适合作为"被监控的 K8s 集群"的可观测性数据源。
- **RocketMQ** 若未来需实时事件推送（多终端协同、K8s 事件流式通知），Go SDK 可作事件总线增强，但对当前桌面终端工具属过度设计。

> 来源：`research/03-domestic-middleware.md` §3.1-3.7、§6.1（ShardingSphere https://shardingsphere.apache.org/index_zh.html ；RocketMQ https://rocketmq.apache.org/zh/ ；Dubbo https://cn.dubbo.apache.org/zh-cn/ ；ServiceComb https://servicecomb.apache.org/ ；SkyWalking https://skywalking.apache.org/ ；Seata https://seata.apache.org/zh-cn/ ；ShenYu https://shenyu.apache.org/zh/ ）

### 3.10 容器与K8s层（Docker/K8s → iSulad/KubeSphere/Volcano/KubeEdge）

| 项 | 现有技术 | 国产替代 | 成熟度 | 可信性 | 迁移成本 |
|----|---------|---------|--------|:------:|:--------:|
| 容器引擎 | Docker / Podman / nerdctl / WSLC（CLI 调用） | **iSulad**（openEuler/华为，需适配 CLI） | 成熟中 | 可信 | 中（需开发 isula CLI 适配层） |
| K8s 客户端 | 手写 REST 客户端（net/http） | **KubeSphere**（多集群 PaaS） | 生产级 | 可信 | 低（REST API 兼容可直连） |
| K8s 边缘 | — | **KubeEdge**（CNCF graduated） | 生产级 | 可信 | 低（边缘场景增强） |
| K8s 调度 | — | **Volcano**（AI/大数据调度，CNCF 孵化） | 成熟中 | 可信 | 低（AI 场景增强） |

**评估要点**：
- **iSulad**：openEuler/华为开源轻量容器引擎（C/C++），开放原子孵化，Mulan PSL v2 许可证，支持 lxc/runc/kata runtime，OCI 镜像格式，提供 CLI（`isula`）/ CRI 接口。**关键限制**：CLI 命令为 `isula`，参数风格与 docker CLI 不完全兼容，不能零修改接入，需扩展 `commands.go` 生成 `isula` 风格命令 + 在 `provider.go` 新增 iSulad Runtime 枚举。
- **KubeSphere**：青云 QingCloud 开源，CNCF 认证容器平台，社区版 v4.2.0。兼容标准 K8s REST API，本项目 K8s 模块可直连。
- **KubeEdge**：华为捐赠，CNCF graduated（已毕业），v1.23.0，边缘自治，兼容 K8s REST API。
- **Volcano**：华为主导并捐赠至 CNCF（孵化中），v1.15.0，面向 AI/大数据场景调度，支持 MindSpore。
- **containerd / Podman**：非国产但本项目已支持（nerdctl / podman Runtime），在国产 OS 上也可安装使用。
- **核心简化**：本项目 K8s 模块为手写 REST 客户端（非 client-go），容器模块为 CLI 调用（非 Docker SDK），因此国产替代评估只需关注 REST API 兼容性（K8s）和 CLI 兼容性（容器），大幅简化。

> 来源：`research/03-domestic-middleware.md` §3.8-3.11、§3.17（iSulad https://gitee.com/openeuler/iSulad ；KubeSphere https://www.kubesphere.io/zh/ ；Volcano https://volcano.sh/zh/ ；KubeEdge https://kubeedge.io/zh/ ）

### 3.11 对象存储层（S3 → OBS/OSS/COS/MinIO/Ceph）

| 项 | 现有技术 | 国产替代 | 协议兼容 | 成熟度 | 可信性 | 迁移成本 |
|----|---------|---------|:--------:|--------|:------:|:--------:|
| 对象存储 | simples3（S3 协议） | **华为 OBS / 阿里 OSS / 腾讯 COS** | ✅ S3 | 生产级 | 可信 | 低（改 endpoint） |
| 本地对象存储 | — | MinIO（**非国产**，美国公司） | ✅ S3 | 生产级 | 可信（但非国产） | 低 |
| 分布式存储 | — | Ceph（**非国产**，Red Hat/社区） | ✅ RGW S3 | 生产级 | 有条件可信 | 高（过度设计） |

**评估要点**：
- **华为 OBS / 阿里 OSS / 腾讯 COS**：均兼容 S3 协议，本项目 `s3_session.go` 可零修改对接（配置 endpoint 即可），是真正的国产替代选项。
- **MinIO**：**美国公司**（注册地 Redwood City, CA 94065），S3 兼容，全球广泛使用，但**非国产，不可计入"国产替代"清单**。其价值在于作为 S3 兼容的本地存储层，可与国产对象存储形成"本地缓存 + 云端同步"组合。
- **Ceph**：Red Hat/社区开源，**非国产**，服务端分布式块/文件/对象存储，对桌面运维终端属过度设计。其 RGW 提供 S3 兼容接口，但部署运维 Ceph 集群远超桌面工具范围。

> 来源：`research/03-domestic-middleware.md` §3.12-3.16（MinIO https://min.io/ ；华为 OBS https://support.huaweicloud.com/obs/index.html ；阿里 OSS https://www.aliyun.com/product/oss ；腾讯 COS https://cloud.tencent.com/product/cos ）

### 3.12 AI框架层（OpenAI/DeepSeek API → MindSpore/昇腾）

| 项 | 内容 |
|----|------|
| 现有技术 | OpenAI / Anthropic / DeepSeek API（云端 API 调用） |
| 国产替代 | MindSpore 2.10（含 Lite、Transformers）、昇腾/CANN（AI 算力硬件） |
| 成熟度 | MindSpore：成熟中（有稳定版本迭代但生态不及 PyTorch）；昇腾/CANN：生产级（AI 算力场景） |
| 可信性等级 | MindSpore：有条件可信（框架真实可用，但"对标 PyTorch"营销口径需打折）；昇腾：可信（针对 AI 算力场景，与桌面应用关联度极低） |
| 迁移成本 | 高（模型迁移成本 + 需昇腾硬件 + 增加 Python 运行时与打包体积） |

**评估要点**：
- **MindSpore**：官方安装页实测最新版本 2.10，主要产品含核心框架、MindSpore Lite（端侧）、MindSpore Transformers（大模型套件）。在昇腾 NPU 上有原生协同优化。
- **与 PyTorch 差距**：算子覆盖、预训练模型数量、第三方库（HuggingFace 等）、社区规模与 PyTorch 差距明显；大量开源模型默认以 PyTorch 权重发布，迁移有成本。
- **本项目关联度中低**：现有架构走云端 API（OpenAI/Anthropic/DeepSeek），本地推理并非必需路径。引入 MindSpore 属新增能力而非替代，且需配套昇腾/NPU 硬件才有性价比。
- **昇腾/CANN**：面向 AI 算力（数据中心/服务器），与"桌面终端管理工具"无关；仅在"想要本地跑大模型做 AI Agent"时才有意义，且需额外硬件，桌面场景几乎不现实。
- **国产大模型 API**：盘古、文心、GLM、通义等可作为云端 API 替代 OpenAI/DeepSeek，属配置层切换，成本低（本次调研未深入展开各模型 API 细节）。

> 来源：`research/01-huawei-base-tech.md` §6-7（MindSpore https://www.mindspore.cn/install ；昇腾 https://www.hiascend.com ；GitCode Ascend https://gitcode.com/ascend ）

### 3.13 加密与国密层（AES-GCM → SM4-GCM/SM2/SM3/铜锁/GmSSL/gmsm）

| 项 | 现有技术 | 国产替代 | 成熟度 | 可信性 | 迁移成本 |
|----|---------|---------|--------|:------:|:--------:|
| 本地存储加密 | AES-256-GCM + PBKDF2-SHA256 | **SM4-GCM（tjfoc/gmsm）** + SM3 KDF（可选） | 中 | 可信（可迁移） | 中（需双读兼容） |
| TLS/通信国密 | 标准 TLS | **铜锁 Tongsuo / GmSSL**（NTLS、SM2 双证书） | 中 | 可信（TLS 场景） | 高（另建链路） |
| 第三方导入兼容 | AES-CBC（Navicat/WindTerm/DBeaver） | **不可替换**（外部私有格式） | — | 保持原样 | 无（禁止改动） |

**评估要点**：
- **国密算法标准**：SM2（GB/T 32918）、SM3（GB/T 32905）、SM4（GB/T 32907）、SM9（标识密码）。标准编号属公开常识，正式合规请以国家密码管理局发布文本为准。
- **tjfoc/gmsm（Go 国密库，首选）**：实现 SM2/SM3/SM4，SM4 提供标准 `cipher.Block` 接口，可无缝接入 `cipher.NewGCM(...)`，使 **SM4-GCM 成为现有 AES-GCM 的近似"同构替换"**。
- **铜锁 Tongsuo（原 BabaSSL）**：OpenSSL 的国密增强分支，支持 SM2 双证书、国密 TLS（NTLS）与 TLS1.3 商用密码套件。**面向服务端/TLS 层**，与桌面客户端内部数据加密不是同一层次，主要用于需要国密 TLS 通信的场景。
- **GmSSL（北大）**：国产商用密码开源库，CI 徽章含 OpenHarmony/Android/iOS。需 CGO/FFI 集成，Go 侧非首选。
- **迁移路径（后端凭据加密）**：新增 `backend/crypto/sm4` 封装，密文前缀由 `enc:v1:` 升级为 `enc:sm4:v1:`，解密函数同时识别两种前缀，实现平滑迁移（老数据惰性重加密）。
- **迁移路径（云同步加密）**：增加算法分支，写入用 SM4-GCM，读取按密文头区分。因同步数据参与 Git 提交与跨设备/跨版本，**必须保留 AES 读取能力至少一个大版本**。
- **第三方导入器绝对不能改**：`backend/importer/*` 的 AES-CBC 是逆向/兼容 Navicat、WindTerm、DBeaver 的私有格式，算法与密钥由对方定义。
- **兼容风险**：版本降级无法解密（需声明"升级不可逆"）；云同步多端混用会冲突（建议同步格式带 `cipher` 元数据字段）。

> 来源：`research/04-xinchuang-adaptation.md` §4（gmsm https://gitee.com/mirrors_tjfoc/gmsm ；铜锁文档 https://tongsuo.readthedocs.io/zh_CN/stable/ ；GmSSL https://gitee.com/mirrors/GmSSL ）

### 3.14 SSH与终端协议层（x/crypto/ssh 国密化可行性）

| 项 | 内容 |
|----|------|
| 现有技术 | golang.org/x/crypto/ssh v0.53.0 + pkg/sftp + creack/pty + UserExistsError/conpty + unixshells/mosh-go |
| 国产替代 | 国密 SSH（SM2/SM3/SM4 用于 SSH 协议）——**无标准化一手依据** |
| 成熟度 | 未能核实（国密 SSH 标准化依据缺失） |
| 可信性等级 | 不可信（证据不足） |
| 迁移成本 | 高（需专用库/国密改造版 OpenSSH，缺乏公开标准化依据，风险高） |

**评估要点**：
- 现有 OpenSSH / golang.org/x/crypto/ssh 默认不支持 SM2/SM3/SM4。
- 铜锁/GmSSL 的国密能力集中在 **TLS（NTLS）**，并不等于 SSH 国密。
- 本次**未能取得关于"国密 SSH"的标准化一手资料**（如具体 RFC 编号或国标号）。
- 若目标环境要求"国密 SSH"，需使用国密改造版 OpenSSH 或专用国密 SSH 库，本项目需替换/桥接 SSH 实现——**这是一项实打实的难点，且缺乏公开标准化依据，风险高**。
- **结论**：在信创落地中，"SSH 通道本身国密化"应作为**独立课题**评估，不建议在现有 SSH 基础上轻率宣称已支持国密。
- **竞品参考**：FinalShell 4.6.3（hostbuf.com）是国内使用较广的 SSH/终端客户端，支持 Windows/macOS/Linux，但官网未宣称"信创适配/国密支持"，与本项目是竞品关系而非可复用替代组件。

> 来源：`research/04-xinchuang-adaptation.md` §5（FinalShell https://www.hostbuf.com/ ）

---

## 4. 全栈替代可行性总览表

| 技术层 | 现有技术 | 首选国产替代 | 备选 | 协议兼容性 | 成熟度 | 可信性等级 | 迁移成本 | 来源 |
|--------|---------|-------------|------|:----------:|--------|:----------:|:--------:|------|
| 芯片/指令集 | x86_64/ARM64 | 鲲鹏(arm64)/海光(x86)/龙芯(loong64) | 飞腾(arm64)/兆芯(x86) | ✅ 原生 | 生产级 | 可信 | 低 | 01 §4 |
| 操作系统 | macOS/Win/Linux | openEuler / 麒麟 V10 / deepin | openKylin / UOS | ✅ Linux 兼容 | 生产级 | 可信 | 低 | 01 §3, 04 §1 |
| 编程语言 | Go 1.26.2 | 仓颉 Cangjie（观察项） | Rust/Python | ❌ 不兼容 | 早期→成熟中 | 有条件可信 | 不可行 | 01 §1 |
| 编译器 | Go gc | 仓颉编译器(LLVM) | 毕昇 JDK/方舟 | — | 未能核实 | 未能核实 | 不适用 | 01 §5 |
| 桌面框架 | Wails v3 | 保持 Wails（已适配） | Electron/Qt/Tauri | — | 成熟中 | 有条件可信 | 低/中/高 | 04 §2 |
| 前端框架 | Vue 3 + TS | 保持 Vue 3 | ArkUI/ArkTS(HarmonyOS 专用) | — | 生产级 | 有条件可信 | 高 | 01 §2, 04 §3 |
| UI 组件库 | Element Plus | OpenTiny/tiny-vue（可选） | TDesign(未核实) | — | 生产级 | 可信 | 中 | 04 §3 |
| 终端模拟 | xterm.js | 无国产替代（保持） | — | — | 生产级 | 可信 | 无 | 00, 01 §1.4 |
| 数据库-MySQL | go-sql-driver/mysql | TiDB | OceanBase/TDSQL/PolarDB/GBase 8s | ✅ | 生产级 | 可信 | 低 | 02 §2.3 |
| 数据库-PG | lib/pq | openGauss | KingbaseES/GBase 8c/PolarDB(PG) | 🟡 | 生产级 | 有条件可信 | 中 | 02 §2.1 |
| 数据库-Oracle | sijms/go-ora | 达梦 DM | OceanBase(Oracle 模式) | 🟡 | 生产级 | 有条件可信 | 高 | 02 §2.5 |
| 数据库-MSSQL | go-mssqldb | 无直接对应 | 整体迁移至国产关系库 | ❌ | — | — | 高 | 02 §5 |
| 数据库-Redis | go-redis | 阿里云 Tair / 腾讯云 Tair | — | ✅ RESP | 生产级 | 可信 | 低 | 02 §2.10 |
| 数据库-MongoDB | mongo-driver | SequoiaDB | GeminiDB(未核实) | 🟡 | 成熟中 | 有条件可信 | 低~中 | 02 §2.11 |
| 数据库-ES | 自研 REST | Easysearch | 腾讯云 ES/CloudSearch | ✅ REST | 成熟中 | 可信 | 低 | 02 §2.12 |
| 中间件-分片 | (无) | ShardingSphere | — | — | 生产级 | 可信 | 不适用(过度设计) | 03 §3.1 |
| 中间件-消息 | (无) | RocketMQ | — | — | 生产级 | 可信 | 不适用(过度设计) | 03 §3.2 |
| 中间件-RPC | (无) | Dubbo / ServiceComb | — | — | 生产级 | 可信 | 不适用(过度设计) | 03 §3.3-3.4 |
| 中间件-APM | (无) | SkyWalking | — | — | 生产级 | 可信 | 中(可选增强) | 03 §3.5 |
| 中间件-事务 | (无) | Seata | — | — | 成熟中 | 有条件可信 | 不适用(过度设计) | 03 §3.6 |
| 中间件-网关 | (无) | ShenYu | — | — | 生产级 | 有条件可信 | 不适用(过度设计) | 03 §3.7 |
| 容器引擎 | Docker/Podman/nerdctl | iSulad（需适配 CLI） | containerd/Podman(已支持) | 🟡 CLI | 成熟中 | 可信 | 中 | 03 §3.10 |
| K8s | 手写 REST 客户端 | KubeSphere | KubeEdge/Volcano | ✅ REST | 生产级 | 可信 | 低 | 03 §3.8-3.9 |
| 对象存储 | simples3(S3) | 华为 OBS / 阿里 OSS / 腾讯 COS | MinIO(非国产) | ✅ S3 | 生产级 | 可信 | 低 | 03 §3.14-3.16 |
| AI 框架 | OpenAI/DeepSeek API | MindSpore（可选增强） | 昇腾/CANN | — | 成熟中 | 有条件可信 | 高 | 01 §6-7 |
| 本地加密 | AES-256-GCM | SM4-GCM（tjfoc/gmsm） | GmSSL/铜锁 | — | 中 | 可信 | 中 | 04 §4 |
| TLS 国密 | 标准 TLS | 铜锁 Tongsuo / GmSSL | — | — | 中 | 可信(TLS) | 高 | 04 §4.2-4.3 |
| SSH 国密 | x/crypto/ssh | 国密 SSH（无标准依据） | — | — | 未能核实 | 不可信 | 高 | 04 §5 |
| 凭据存储 | go-keyring | 国密加密 + 系统密钥环 | — | — | — | 有条件可信 | 中 | 00, 04 §4 |

---

## 5. 迁移路线图

### 5.1 短期（0-3 月）— 基础落地，低风险

| 序号 | 行动项 | 技术层 | 改动范围 | 预期收益 | 风险 |
|:---:|--------|--------|---------|---------|------|
| S1 | **CPU 多架构构建** | 芯片/指令集 | CI 增加 arm64（鲲鹏/飞腾）、loong64（龙芯）目标架构构建与测试 | 覆盖国产 CPU 交付场景 | 低（龙芯需充分测试第三方 Go 依赖纯净度） |
| S2 | **国产 OS 适配完善** | 操作系统 | 完善 openEuler / 麒麟 V10 / deepin 的 WebKitGTK 适配与打包；调研麒麟 V11 开明包格式 | 信创交付能力 | 低（项目已有 webkit40 适配基础） |
| S3 | **数据库驱动替换（MySQL/Redis/ES）** | 数据库 | MySQL → TiDB/OceanBase（改 DSN）；Redis → Tair（改连接串）；ES → Easysearch（改 baseUrl） | 数据库层国产化 | 低（协议兼容，需回归测试） |
| S4 | **对象存储迁移** | 对象存储 | `s3_session.go` endpoint 配置支持华为 OBS / 阿里 OSS / 腾讯 COS | 数据主权合规 | 低（S3 协议兼容） |

### 5.2 中期（3-12 月）— 深度替代，需工程化

| 序号 | 行动项 | 技术层 | 改动范围 | 预期收益 | 风险 |
|:---:|--------|--------|---------|---------|------|
| M1 | **国密加密替换** | 加密 | AES-GCM → SM4-GCM（tjfoc/gmsm），密文格式版本化 + 双读兼容，惰性重加密 | 国密合规 | 中（版本降级不可逆、多端兼容） |
| M2 | **国产数据库 PoC（PG/Oracle）** | 数据库 | PG → openGauss（换官方 fork 驱动）；Oracle → 达梦 DM（新增 provider + SQL 方言适配） | PG/Oracle 国产化 | 中~高（Oracle 需重写模块） |
| M3 | **iSulad 容器引擎适配** | 容器 | 扩展 `commands.go` 生成 `isula` 风格命令 + `provider.go` 新增 iSulad Runtime | 国产容器引擎支持 | 中（CLI 不完全兼容） |
| M4 | **K8s 国产发行版对接** | K8s | 验证 KubeSphere/KubeEdge/Volcano REST API 直连 | 多集群/边缘/AI 调度增强 | 低（REST 兼容） |
| M5 | **MongoDB 国产替代 PoC** | 数据库 | SequoiaDB 协议兼容性实测 | MongoDB 国产化 | 中（协议待实测） |

### 5.3 长期（12 月+）— 观察项，需充分评估

| 序号 | 行动项 | 技术层 | 改动范围 | 预期收益 | 风险 |
|:---:|--------|--------|---------|---------|------|
| L1 | **仓颉/HarmonyOS 专用版评估**（观察项） | 编程语言/前端 | 仓颉替代 Go 后端（关键库缺失，需 FFI/自研）；ArkUI/ArkTS 重写前端（94 组件） | HarmonyOS 生态覆盖 | 不可行（当前生态不支持，3-5 年观察） |
| L2 | **国密 SSH 课题**（观察项） | SSH | 跟踪国密 SSH 标准化进展，评估国密改造版 OpenSSH / 专用库 | SSH 通道国密化 | 高（缺乏标准化依据） |
| L3 | **MindSpore/昇腾本地推理**（可选增强） | AI | 评估 MindSpore Transformers 本地推理 + 昇腾硬件性价比 | AI 本地推理能力 | 高（需硬件 + 模型迁移） |
| L4 | **信创认证流程** | 合规 | 通过 OS 厂商生态适配互认证 + 等保 2.0 + 密评 | 进入信创采购清单 | 高（流程与周期长，需向厂商/评测机构确认） |

> **路线图说明**：短期项均为低风险、高收益的基礎落地工作，项目已有基础（webkit40 适配、provider 插件式架构、S3 协议对接），应优先实施。中期项需工程化处理但路径清晰。长期项标注为**观察项**，不建议在当前技术成熟度下投入大量资源，应持续跟踪生态发展。

---

## 6. 关键风险与夸大宣传警示

本节汇总各调研文件中发现的夸大宣传点与关键风险，**采购/技术决策时必须警惕**：

### 6.1 仓颉生态关键库缺失

- 仓颉语言真实可用、已开源（Apache-2.0），但**生态早期**，桌面/终端类应用所需关键库完全缺失：
  - ❌ **SSH / SFTP / SCP 客户端**（无任何仓颉库）——终端应用最核心的协议
  - ❌ **VNC / RDP 远程桌面**
  - ❌ **终端 PTY + VT/ANSI 转义序列解析**
  - ❌ **MongoDB 驱动、Elasticsearch 客户端**
- 鸿蒙版仍"内测及试点商用"，IDE 仍在内测。
- **切勿将其宣传为"现成替代方案"**，最多作为长期（3-5 年）观察项。

> 来源：`research/01-huawei-base-tech.md` §1.4、§10.2

### 6.2 "兼容 Oracle" ≠ 兼容协议

- 达梦、OceanBase Oracle 模式、GBase 的 Oracle 兼容均为**语法/对象兼容**（语法兼容度 90%/95%），**非 wire protocol 兼容**。
- 替换 Oracle 模块仍需替换驱动、改造成本不可低估。
- 达梦官网"Oracle 兼容性业内最佳"、OceanBase 官网"高度兼容 Oracle"均为**宣传口径**，须以实际 SQL 兼容测试为准。
- "语法兼容度 90%/95%"（GBase 8s 官网明示）意味着**仍有 5%~10% 语法不兼容**，需逐条回归。

> 来源：`research/02-domestic-database.md` §8

### 6.3 MinIO 是美国公司非国产

- MinIO 注册地 Redwood City, CA 94065，**非国产**。
- 虽 S3 兼容且在中国广泛使用，但**不可计入"国产替代"清单**。
- 其价值在于作为 S3 兼容的本地存储层，可与国产对象存储形成组合。

> 来源：`research/03-domestic-middleware.md` §3.12、§6.2

### 6.4 方舟编译器非通用编译器

- 方舟编译器当前公开能力集中在 **ArkTS/JS 的运行时与前端编译**，未证实可用于通用 C/C++/Java 的编译。
- 网上"方舟编译器全面开源替代 GCC/LLVM"的说法**缺乏证据支持，属夸大宣传**。
- 应限定在 OpenHarmony 运行时语境理解。

> 来源：`research/01-huawei-base-tech.md` §5.3、§10.2

### 6.5 国密 SSH 缺乏标准化依据

- 本次**未能取得关于"国密 SSH（SM2/SM3/SM4 用于 SSH 协议）"的标准化一手资料**（如具体 RFC 编号或国标号）。
- 铜锁/GmSSL 的国密能力集中在 **TLS（NTLS）**，并不等于 SSH 国密。
- 不建议在现有 SSH（x/crypto/ssh）基础上轻率宣称已支持国密，应作为**独立课题**评估。

> 来源：`research/04-xinchuang-adaptation.md` §5.2

### 6.6 OpenHarmony 作桌面平台属过度延展

- OpenHarmony 上游定位为智能终端 OS（手机、平板、IoT、车机），**桌面 PC 应用开发/分发能力本次未能核实**。
- 不宜作为通用桌面替代方案。
- ArkTS/ArkUI 仅适合"HarmonyOS 专用版"，需重写 8.2 万行前端且**失去 macOS/Windows/Linux 跨平台能力**。

> 来源：`research/01-huawei-base-tech.md` §2.5、§10.2

### 6.7 华为云商用产品官网反爬，关键证据缺失

- 华为云 GaussDB、GeminiDB for Mongo、CloudSearch 产品页为前端渲染/反爬脚本，**本次无法取证**具体版本号、协议兼容性、Go 驱动支持。
- **不应在缺乏官方协议证据时将其列入"确定可替换"**，需现场 PoC 验证。

> 来源：`research/02-domestic-database.md` §2.2、§9

### 6.8 服务端中间件对桌面终端工具属过度设计

- ShardingSphere、Dubbo、ServiceComb、ShenYu、Seata 均为**服务端中间件**，解决服务端分布式系统问题。
- 本项目是桌面端 AI 运维终端工具，**不构成直接替代关系**，强行引入属过度设计，违背桌面工具轻量化原则。
- 间接价值有限：仅在"本项目运维的目标集群使用了这些中间件"时才有运维观察价值。

> 来源：`research/03-domestic-middleware.md` §6.1

### 6.9 UI 组件库替换是"形象工程"而非技术必需

- Element Plus 是纯前端 npm 包，不涉及"是否国产"的运行风险。
- 替换为 OpenTiny 的主要动机是"信创形象/合规"，收益有限、回归风险高。
- **建议非必要不换**。

> 来源：`research/04-xinchuang-adaptation.md` §3、§9

### 6.10 麒麟 V11 磐石架构/开明包格式不确定性

- 麒麟 V11 引入磐石架构（不可变系统）+ 开明包格式，传统 deb/tar.xz 安装包可能需转换或适配。
- 官网未提供面向第三方开发者的完整迁移文档一手证据，**部分未能核实**，需在目标环境实测。

> 来源：`research/04-xinchuang-adaptation.md` §1.6、§9

---

## 7. 未能核实事项汇总

> 以下事项在各调研文件中标注「未能核实」，需在后续 PoC / 现场验证中补全。**本报告不编造任何未能核实的内容。**

### 7.1 华为系基础技术（来源：01-huawei-base-tech.md）

| 序号 | 事项 | 原因 |
|:---:|------|------|
| 1 | 仓颉各版本的精确发布日期 | 仅页面显示 `2025/08/22` 一处，未逐版本取证 |
| 2 | 仓颉 FFI/C 互操作 API 的规范性细节 | 仅确认存在"多语言桥接工具"与多个 FFI 库 |
| 3 | OpenHarmony 桌面（PC/2in1）应用开发与分发能力 | 文档以设备与应用开发为主，未找到成熟桌面 PC 事实依据 |
| 4 | DevEco Studio 的静态详情 | 官网 SPA，未抓到静态详情 |
| 5 | 鲲鹏 920 / 海光 / 兆芯 的指令集原文与具体参数 | 官网 SPA 或 404，未取证 |
| 6 | 毕昇 C/C++ 编译器的官方仓库与文档 | `bisheng-compiler` 404 |
| 7 | CANN 精确版本号 | 仅 360 搜索旁证为 8.0，未从官网静态页核实 |
| 8 | 华为云具体产品页参数 | SPA 未取证 |
| 9 | 仓颉中心仓三方库总数 | `pkg.cangjie-lang.cn` 为 SPA，未取到统计数字 |

### 7.2 国产数据库（来源：02-domestic-database.md）

| 序号 | 事项 | 原因 |
|:---:|------|------|
| 10 | 华为 GaussDB（商用）版本号、协议兼容性、Go 驱动 | 官网前端渲染/反爬，抓取到混淆 JS |
| 11 | 华为云 GeminiDB for Mongo 版本、MongoDB 协议兼容性 | 官网反爬 |
| 12 | 华为云 CloudSearch 版本、ES 兼容性 | 官网反爬 |
| 13 | openGauss 所基于 PostgreSQL 内核具体版本号 | `docs.opengauss.org` 返回 HTTP 403 |
| 14 | KingbaseES 基于 PostgreSQL 内核的官方直接声明 | 官网 product/文档路径 404，`help.kingbase.com.cn` 无法连接 |
| 15 | GBase 8c 是否基于 openGauss 内核 | 官网自述"自主研发"，未提 openGauss |
| 16 | GBase 各产品对外暴露的 wire protocol 类型 | 官网只强调"语法兼容模式" |
| 17 | SequoiaDB 是否兼容 MongoDB wire protocol | 官网仅以"国产化替换首选"作定位，未明示协议兼容性 |
| 18 | Easysearch 是否 100% 兼容 ES 7.x/8.x REST API | 官网称向下兼容至 6.x 索引，未逐一列明 API 覆盖度 |
| 19 | KeyDB 的国产化属性与版本 | GitHub 不可访问，KeyDB 实际为国外（Snap）主导项目 |

### 7.3 国产中间件与容器（来源：03-domestic-middleware.md）

| 序号 | 事项 | 原因 |
|:---:|------|------|
| 20 | ServiceComb Go 支持（go-chassis）当前维护状态 | 未在官网首页确认 |
| 21 | ShenYu 前身 Soul（京东）关联 | 官网首页未直接背书 |
| 22 | Ceph 中文社区状态 | `docs.ceph.org.cn` 证书验证错误，`ceph.org.cn` 抓取失败 |

### 7.4 信创适配（来源：04-xinchuang-adaptation.md）

| 序号 | 事项 | 原因 |
|:---:|------|------|
| 23 | 统信 UOS 专业版/服务器版版本号与市场份额 | `www.uniontech.com` 超时 |
| 24 | 铜锁官网与维护主体、具体版本 | `tongsuo.net` 被 CDN 403 拦截 |
| 25 | GmSSL 官网 | `gmssl.cn` 超时 |
| 26 | TDesign（腾讯）组件库定位 | `tdesign.tencent.com` 超时 |
| 27 | 红莲花 / 华为 ArkWeb / 360 / 奇安信 内核细节 | 站点 403 / 未取得正文 |
| 28 | 信创产品目录条目与证书编号 | 无公开权威在线入口 |
| 29 | 国密 SSH 的标准/RFC 编号 | 未取得一手资料 |
| 30 | Wails 官方 Linux 依赖原文 | `wails.io` 触发 Cloudflare 验证 |
| 31 | 前端 JS 国密库具体选型 | 未核实，不背书 |
| 32 | 麒麟 V11 磐石架构/开明包对第三方安装包的影响 | 官网未提供完整迁移文档一手证据 |

---

## 8. 来源索引

> 汇总本报告引用的所有 URL，按类别整理。

### 8.1 仓颉 / OpenHarmony / ArkTS / ArkUI

| # | 来源 | URL |
|---|------|-----|
| 1 | 仓颉编程语言官网-首页 | https://cangjie-lang.cn |
| 2 | 仓颉编程语言官网-下载中心 | https://cangjie-lang.cn/download |
| 3 | 仓颉编程语言官网-文档 | https://cangjie-lang.cn/docs |
| 4 | GitCode Cangjie 组织 | https://gitcode.com/Cangjie |
| 5 | GitCode cangjie_stdx | https://gitcode.com/Cangjie/cangjie_stdx |
| 6 | GitCode Cangjie-TPC 组织 | https://gitcode.com/Cangjie-TPC |
| 7 | GitCode TPC-Resource（三方库汇总） | https://gitcode.com/Cangjie-TPC/TPC-Resource |
| 8 | Gitee OpenHarmony 组织 | https://gitee.com/openharmony |
| 9 | GitCode OpenHarmony 组织 | https://gitcode.com/openharmony |
| 10 | GitCode openharmony/docs | https://gitcode.com/openharmony/docs |
| 11 | OpenHarmony ArkTS 入门文档 | https://gitcode.com/openharmony/docs/blob/master/zh-cn/application-dev/quick-start/arkts-get-started.md |
| 12 | OpenHarmony ArkUI 声明式开发概述 | https://gitcode.com/openharmony/docs/blob/master/zh-cn/application-dev/ui/arkts-ui-development-overview.md |
| 13 | GitCode arkcompiler_runtime_core | https://gitcode.com/openharmony/arkcompiler_runtime_core |

### 8.2 openEuler / 国产 OS / 国产芯片

| # | 来源 | URL |
|---|------|-----|
| 14 | openEuler 官网-下载中心 | https://www.openeuler.org/zh/download/ |
| 15 | GitCode openEuler 组织 | https://gitcode.com/openeuler |
| 16 | Gitee openEuler / bishengjdk-8 | https://gitee.com/openeuler/bishengjdk-8 |
| 17 | 鲲鹏社区官网 | https://www.hikunpeng.com |
| 18 | 华为企业业务-鲲鹏计算 | https://e.huawei.com/cn/products/computing/kunpeng |
| 19 | 数字飞腾门户-产品 | https://www.phytium.com.cn/ |
| 20 | 龙芯中科官网 | https://www.loongson.cn |
| 21 | 海光信息官网 | https://www.hygon.cn |
| 22 | 兆芯官网 | https://www.zhaoxin.com |
| 23 | Go 官方下载页（架构支持） | https://golang.google.cn/dl/ |
| 24 | 麒麟软件官网 | https://www.kylinos.cn/ |
| 25 | 银河麒麟桌面操作系统 V11 | https://www.kylinos.cn/productPc/desktop/desktopMainV11/ |
| 26 | 麒麟生态兼容清单 | https://www.kylinos.cn/eco/ecoSearch/compatibleList/index.html |
| 27 | openKylin 社区官网 | https://www.openkylin.top/ |
| 28 | openKylin 兼容适配 | https://www.openkylin.top/support/ |
| 29 | deepin 官网 | https://www.deepin.org/index/zh |
| 30 | 统信 UOS 家庭版官网 | https://home.uniontech.com/ |

### 8.3 国产数据库

| # | 来源 | URL |
|---|------|-----|
| 31 | openGauss 社区官网 | https://www.opengauss.org/zh/ |
| 32 | openGauss 软件包下载页 | https://www.opengauss.org/zh/download/ |
| 33 | openGauss-connector-go-pq（Gitee） | https://gitee.com/opengauss/openGauss-connector-go-pq |
| 34 | TiDB 官方文档 | https://docs.pingcap.com/zh/tidb/stable/overview |
| 35 | TiDB 8.5.0 Release Notes | https://docs.pingcap.com/zh/tidb/stable/release-8.5.0 |
| 36 | TiDB 与 MySQL 兼容性对比 | https://docs.pingcap.com/zh/tidb/stable/mysql-compatibility |
| 37 | OceanBase 官网 | https://www.oceanbase.com/ |
| 38 | OceanBase 社区版产品页 | https://www.oceanbase.com/product/opensource |
| 39 | 达梦数据官网 | https://www.dameng.com/ |
| 40 | 达梦官方 Go 驱动（Gitee） | https://gitee.com/chunanyong/dm |
| 41 | 达梦技术文档 | https://eco.dameng.com/document/dm/zh-cn/start/ |
| 42 | 人大金仓官网 | https://www.kingbase.com.cn/ |
| 43 | GBase 8c 产品页 | https://www.gbase.cn/product/gbase-8c |
| 44 | GBase 8s 产品页 | https://www.gbase.cn/product/gbase-8s |
| 45 | GBase 8a 产品页 | https://www.gbase.cn/product/gbase-8a |
| 46 | 阿里云 PolarDB 产品页 | https://www.aliyun.com/product/polardb |
| 47 | 腾讯云 TDSQL 产品页 | https://cloud.tencent.com/product/tdsql |
| 48 | 阿里云 Tair 产品页 | https://www.aliyun.com/product/redis |
| 49 | 腾讯云分布式缓存产品页 | https://cloud.tencent.com/product/crs |
| 50 | 腾讯云分布式缓存文档 | https://cloud.tencent.com/document/product/239 |
| 51 | 巨杉数据库官网 | http://www.sequoiadb.com/ |
| 52 | Easysearch 官网 | https://www.easysearch.cn/ |
| 53 | 腾讯云 ES 产品页 | https://cloud.tencent.com/product/es |
| 54 | OpenSearch 官网 | https://opensearch.org/ |

### 8.4 国产中间件与容器/K8s

| # | 来源 | URL |
|---|------|-----|
| 55 | Apache ShardingSphere 官网 | https://shardingsphere.apache.org/index_zh.html |
| 56 | Apache RocketMQ 官网 | https://rocketmq.apache.org/zh/ |
| 57 | Apache Dubbo 官网 | https://cn.dubbo.apache.org/zh-cn/ |
| 58 | Apache ServiceComb 官网 | https://servicecomb.apache.org/ |
| 59 | Apache SkyWalking 官网 | https://skywalking.apache.org/ |
| 60 | Apache Seata 官网 | https://seata.apache.org/zh-cn/ |
| 61 | Apache ShenYu 官网 | https://shenyu.apache.org/zh/ |
| 62 | KubeSphere 官网 | https://www.kubesphere.io/zh/ |
| 63 | Volcano 官网 | https://volcano.sh/zh/ |
| 64 | iSulad Gitee 仓库 | https://gitee.com/openeuler/iSulad |
| 65 | iSulad AtomGit 仓库 | https://atomgit.com/openeuler/iSulad |
| 66 | KubeEdge 官网 | https://kubeedge.io/zh/ |
| 67 | MinIO 官网 | https://min.io/ |
| 68 | 华为 OBS 文档 | https://support.huaweicloud.com/obs/index.html |
| 69 | 阿里云 OSS 产品页 | https://www.aliyun.com/product/oss |
| 70 | 腾讯云 COS 产品页 | https://cloud.tencent.com/product/cos |

### 8.5 AI 框架 / 昇腾 / 华为云

| # | 来源 | URL |
|---|------|-----|
| 71 | MindSpore 官网-安装 | https://www.mindspore.cn/install |
| 72 | 昇腾社区官网 | https://www.hiascend.com |
| 73 | GitCode Ascend 组织 | https://gitcode.com/ascend |
| 74 | 华为云官网 | https://www.huaweicloud.com |

### 8.6 国密 / 桌面框架 / UI 组件 / 信创

| # | 来源 | URL |
|---|------|-----|
| 75 | Tauri 官网 | https://v2.tauri.app/ |
| 76 | Qt 官网 | https://www.qt.io/ |
| 77 | OpenTiny 官网 | https://www.opentiny.design/ |
| 78 | tiny-vue - Gitee | https://gitee.com/opentiny/tiny-vue |
| 79 | Arco Design 官网 | https://arco.design/ |
| 80 | Semi Design 官网 | https://semi.design/ |
| 81 | ant-design - Gitee | https://gitee.com/ant-design/ant-design |
| 82 | Tongsuo 文档 | https://tongsuo.readthedocs.io/zh_CN/stable/ |
| 83 | GmSSL - Gitee 镜像 | https://gitee.com/mirrors/GmSSL |
| 84 | gmsm - Gitee 镜像 | https://gitee.com/mirrors_tjfoc/gmsm |
| 85 | FinalShell 官网 | https://www.hostbuf.com/ |
| 86 | 奇安信官网 | https://www.qianxin.com/ |
| 87 | 360 浏览器官网 | https://browser.360.cn/ |

### 8.7 本项目源码（内部取证）

| # | 来源 | 说明 |
|---|------|------|
| 88 | `go.mod` / `go.sum` | 依赖清单（无 k8s.io/client-go、无 docker SDK） |
| 89 | `frontend/package.json` | 前端依赖清单 |
| 90 | `.github/workflows/build-linux-webkit40.yml` | 国产 OS 适配构建（Kylin V10/RHEL 8/openEuler） |
| 91 | `backend/k8s/client.go` | 手写 K8s REST 客户端 |
| 92 | `backend/k8s/kubeconfig.go` | 自研 Kubeconfig 解析 |
| 93 | `backend/container/runner_local.go` | 容器 CLI 本地执行 |
| 94 | `backend/container/commands.go` | 容器命令生成 |
| 95 | `backend/container/provider.go` | Runtime 枚举（docker/podman/nerdctl/WSLC） |
| 96 | `backend/sync/git.go` | Git 仓库同步（go-git/v5） |
| 97 | `backend/sync/crypto.go` | 云同步加密（AES-GCM + AAD） |
| 98 | `backend/credentials/crypto.go` | 凭据加密（AES-256-GCM） |
| 99 | `backend/sync/keychain.go` | 密钥派生（PBKDF2-SHA256） |
| 100 | `backend/session/s3_session.go` | S3 协议客户端（simples3） |
| 101 | `backend/session/elasticsearch_session.go` | 自研 ES REST 客户端 |
| 102 | `backend/database/provider.go` | 数据库 Provider 接口定义 |
| 103 | `backend/importer/{navicat,windterm,dbeaver}.go` | 第三方导入器（AES-CBC，不可替换） |

---

*报告完。本报告汇总自 `research/00`～`research/04` 五份独立调研文件，所有结论附来源；未能核实事项明确标注；严格区分官方宣传与实际生产可用；不凭空捏造技术、版本号、库名、URL。*