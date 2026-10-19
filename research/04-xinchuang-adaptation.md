# 信创适配与国产 OS / 桌面框架 / 国密安全 调研报告

> 调研对象：uniTerm（原 uniTerm）
> 技术栈：Wails v3（Go 桌面框架 + 系统 WebView）+ Go 后端 + Vue 3 / TypeScript / Element Plus 前端
> 调研日期：2026-10-12
> 网络环境：GitHub / Google 等境外站点不可访问；本次可访问 oschina.net、gitee.com、baidu.com、huaweicloud.com，以及部分国产 OS / 开源项目官网。

---

## 0. 阅读须知（关于严谨性）

本报告严格区分三类信息，并在每条结论后标注：

- **[已核实]**：本次通过可访问站点实际抓取到内容，并附来源 URL。
- **[厂商宣传]**：厂商官网自述，未做独立验证。
- **[未能核实]**：目标站点超时、返回错误码、需要登录或验证码，无法取得一手资料。此类内容**不编造**，明确标注。

本次调研中**不可用**的站点（如实记录）：

| 站点 | URL | 结果 |
|---|---|---|
| 统信软件官网 | https://www.uniontech.com/ | HTTP 000（超时，多次尝试） |
| 统信生态社区 | https://www.chinauos.com/ | HTTP 000（超时） |
| 铜锁官网 | https://www.tongsuo.net/ | HTTP 403（阿里云 ESA/CDN 拦截） |
| GmSSL 官网 | https://www.gmssl.cn/ | HTTP 000（超时） |
| Wails 官网 | https://wails.io/ | Cloudflare「Just a moment…」人机验证 |
| TDesign 官网 | https://tdesign.tencent.com/ | HTTP 000（超时） |
| 百度百科 | https://baike.baidu.com/ | 触发安全验证码 |
| 红莲花浏览器 | https://www.redlotus.cn/ | HTTP 403（无法取得内容） |

可访问并已取证：麒麟 kylinos.cn、openKylin openkylin.top、deepin deepin.org、openEuler openeuler.org、铜锁文档 tongsuo.readthedocs.io、gitee.com、arco.design、semi.design、hostbuf.com（FinalShell）、home.uniontech.com（UOS 家庭版页）。

---

## 1. 国产操作系统

### 1.1 银河麒麟 Kylin（麒麟软件）

- **[已核实]** 麒麟软件官网当前主推**银河麒麟桌面操作系统 V11**（"新架构/新生态/新体验/新安全"四大特性），同时保留 V10 主线产品；服务器侧为银河麒麟高级服务器操作系统 V11/V10。官方称 V11"基于全新内核开发"，采用自研**磐石架构（不可变系统）**与**开明包格式**（轻量级沙箱、分层管理、支持 deb 包一键转开明包），"同源支持国内外主流处理器架构"。
  > 来源：[银河麒麟桌面操作系统V11 - 麒麟软件](https://www.kylinos.cn/productPc/desktop/desktopMainV11/)
  > 来源：[麒麟软件官网首页](https://www.kylinos.cn/)
- **[厂商宣传]** V11 页面宣称"通过商密 / 等保 / 行标认证"，并宣传 Kylin SDK（应用支撑 SDK、系统能力 SDK、安全管控 SDK、基础开发 SDK、AI 能力 SDK）；安全侧宣传 KSAF 安全框架、双因子认证、磁盘加密、可信启动等。
  > 来源：[银河麒麟桌面操作系统V11 - 麒麟软件](https://www.kylinos.cn/productPc/desktop/desktopMainV11/)
- **[已核实]** 麒麟设有**生态适配体系**：官网"生态合作 / 生态查询"下提供"生态兼容清单""适配证书查询""适配驱动查询""生态标准规范"入口，并支持"适配申请"。
  > 来源：[生态兼容清单 - 麒麟软件](https://www.kylinos.cn/eco/ecoSearch/compatibleList/index.html)
- **[已核实]** 麒麟新闻栏出现过"原生生态开发赛""国有大行 22 万台网信终端部署"等厂商动态，属于**厂商宣传**性质，未做独立验证。
  > 来源：[麒麟软件官网首页 - 麒麟动态](https://www.kylinos.cn/)

### 1.2 openKylin（开放麒麟，开源社区版）

- **[已核实]** openKylin 是开源社区发行版（"开源聚力，共创未来"），当前**最新版本 openKylin 3.0（x86）**，**稳定版本 openKylin 2.0 SP2**，并提供 **RISC-V、ARM** 多架构镜像；桌面环境为 **UKUI**；源码托管在 **gitee.com/openkylin**。
  > 来源：[openKylin 社区官网](https://www.openkylin.top/)
- **[已核实]** 社区提供"兼容适配规范 / 兼容适配列表 / 兼容适配申请"，以及"软件包编译平台、发行构建平台、CI 平台、第三方开源组件库"等开发者基础设施。
  > 来源：[兼容适配 - openKylin](https://www.openkylin.top/support/)

### 1.3 深度 deepin

- **[已核实]** deepin 当前主版本为 **deepin 25**，最新镜像 **deepin 25.2.0**（官方称聚焦 Treeland 稳定性、文件管理、DDE 交互与稳定性）。桌面环境为自研 **DDE**，应用基于自研 **DTK** 套件开发；官方称兼容大部分 Windows 与安卓软件，应用商店约"40000+ 款"应用；源码主要托管于 GitHub `linuxdeepin` 组织（本环境 GitHub 不可访问）。
  > 来源：[deepin 官网首页](https://www.deepin.org/index/zh)

### 1.4 统信 UOS

- **[已核实（部分）]** 统信官网 `www.uniontech.com` 在本环境**超时无法访问**；可访问的是**统信 UOS 家庭版**页面：**统信 UOS 家庭版 V22.0**，官方称"以统信 UOS 生态为主线，过渡性兼容 Windows 生态和安卓生态"，面向个人用户。
  > 来源：[统信UOS家庭版官网](https://home.uniontech.com/)
- **[未能核实]** 统信 UOS 专业版/服务器版的**具体版本号、市场份额、WebView 组件版本**因官网不可达，本次未取得一手资料。网络上关于"UOS 市占率第一"等说法多为二手报道，本报告不予采信。

### 1.5 openEuler 桌面版

- **[已核实]** openEuler 最新社区版为 **openEuler 26.09**；官方定位为"面向数字基础设施的全场景开源操作系统"，覆盖服务器、云计算、边缘计算、嵌入式四大场景，**全面支持 ARM、x86、RISC-V、LoongArch、PowerPC、SW-64** 架构；许可证为木兰宽松许可证第 2 版（MulanPSL2）。
  > 来源：[openEuler 社区官网](https://www.openeuler.org/zh/)
- **[说明]** openEuler 以服务器场景为主，桌面生态较 Kylin/deepin/UOS 弱；其桌面版更多作为技术验证与行业定制基座。

### 1.6 桌面应用兼容性 / WebView 支持（关键难点）

- **[已核实·项目自证]** 本项目已在 `.github/workflows/build-linux-webkit40.yml` 中**专门为国产 OS 构建独立包**，文件头注释原文（节选）：

  > `Standalone package for Kylin V10 / RHEL 8 / openEuler:`
  > `- Built in Rocky Linux 8 → glibc 2.28`
  > `- Links webkit2gtk-4.0 (package webkit2gtk3) WITHOUT -tags webkit2_40`
  > `  (that tag forces runtime WebKit >= 2.40, which old Kylin repos often lack)`

  这直接证明：**Wails v3 在 Linux 上依赖系统 `WebKitGTK`（webkit2gtk-4.0，对应包名 webkit2gtk3）**；国产旧版仓库（如麒麟 V10）常常**缺少 WebKit ≥ 2.40**，因此需要按 4.0 ABI 链接、避免强制高版本。
  > 来源：项目文件 `.github/workflows/build-linux-webkit40.yml`（本地仓库）

- **[已核实·构建依赖]** 同一 workflow 编译环境安装的是 `gtk3-devel` 与 `webkit2gtk3-devel`，进一步印证 Linux 桌面栈 = **GTK3 + WebKitGTK**。
  > 来源：项目文件 `.github/workflows/build-linux-webkit40.yml`

- **[难点归纳]**
  1. Wails/Tauri 这类"系统 WebView"框架在国产 Linux OS 上**全部落到 WebKitGTK**，其版本与 ABI（4.0 vs 4.1）碎片化是首要坑；xterm.js 等高交互前端组件对 WebKitGTK 的 JS/GPU 性能也更敏感。
  2. 麒麟 V11 引入**磐石架构（不可变系统）+ 开明包格式**，传统 `deb` / `tar.xz` 安装包可能需转换或适配"开明包"，打包链路存在不确定性（官网未提供面向第三方开发者的完整迁移文档一手证据，**部分未能核实**）。
  3. 龙芯（LoongArch）、ARM64 等国产 CPU 需交叉编译及对应 Go/Node 工具链；本项目 workflow 目前仅覆盖 x86_64（Rocky 8 容器）。
  4. 缺少 GPU 驱动/硬件加速时，WebKitGTK 可能回退软件渲染，终端大数据量渲染性能下降。

### 1.7 成熟度评级（国产 OS 作为运行平台）

| 平台 | 桌面成熟度 | 与 Wails（WebKitGTK）契合 | 评级 | 说明 |
|---|---|---|---|---|
| 银河麒麟 V10/V11 | 高 | 中（需 webkit2gtk-4.0 适配） | **可信** | 生态最全，有适配清单；项目已专门适配 |
| 统信 UOS | 高 | 中（官网不可达，未直接验证） | **有条件可信** | 家庭版可访问，专业版资料缺失 |
| deepin 25 | 高 | 中 | **可信** | 基于 Debian 系，WebKitGTK 可获得 |
| openKylin 3.0 | 中 | 中 | **可信（社区版）** | 社区活跃，适配规范公开 |
| openEuler 桌面 | 中（服务器强） | 中 | **有条件可信** | 桌面非主战场 |

---

## 2. 桌面应用框架的国产化方案

### 2.1 Wails v3（现状）

- **[已核实·项目自证]** 项目依赖 `github.com/wailsapp/wails/v3 v3.0.0-beta.16`，前端 `@wailsio/runtime ^3.0.0-beta.16`。Wails 本身是 Go + 系统 WebView 的"轻量"方案，**无自研渲染引擎**。
  > 来源：项目 `go.mod` / `frontend/package.json`
- **[未能核实]** Wails 官网 `wails.io` 被 Cloudflare 人机验证拦截，未能取得其官方 Linux 依赖说明原文；但由 §1.6 项目自证可确认 Linux 侧依赖 WebKitGTK。
- **[结论]** Wails v3 仍是 **beta**，本身在国产 OS 上可行但需处理 WebKitGTK 版本问题（项目已处理）。它**不是**国产框架，也不应期待有"国产 Wails 替代品"。

### 2.2 Tauri（Rust）

- **[已核实]** Tauri 当前为 **Tauri 2.0**。
  > 来源：[Tauri 官网](https://v2.tauri.app/)
- **[分析]** Tauri 与 Wails 架构同源——同样使用**系统 WebView**（Windows WebView2 / macOS WKWebView / Linux WebKitGTK）。因此**换成 Tauri 不能规避 §1.6 的 WebView 依赖问题**，只是把 Go 换成 Rust。若"去 WebView 依赖"是硬性目标，Tauri 不是答案。

### 2.3 Qt（信创广泛采用）

- **[已核实]** Qt 官网定位"Tools for Each Stage of Software Development Lifecycle"，明确覆盖**桌面与移动端、嵌入式、工业自动化、汽车、医疗**等场景。
  > 来源：[Qt 官网](https://www.qt.io/)
- **[分析]** Qt 使用**自带渲染**（QWidget/QML 自绘，或 QtWebEngine 内嵌 Chromium），**不依赖系统 WebView**，因此在国产 OS 上规避了 WebKitGTK 版本坑；且 Qt 是信创行业事实上的主流桌面技术栈（大量国产客户端、CAD、工控软件基于 Qt）。代价是：需用 C++/QML 重写前端，**无法复用现有 Vue 3 代码**（可用 QtWebEngine 内嵌，但那样又回到 Chromium 内嵌的"重客户端"路线）。**是否有面向 Qt 的 Vue 复用方案，本次未取得一手资料。**

### 2.4 Electron（自带 Chromium）

- **[未能核实]** `electronjs.org` 本次未成功取到正文（未单独重试）。
- **[分析]** Electron 内嵌 Chromium，**不依赖系统 WebView**，国产 OS 上兼容性主要取决于 glibc/库版本与 Electron 自身对 LoongArch/ARM 的发行支持。缺点是体积大、内存高，与 Wails 的"轻量"定位相悖。若复用现有 Vue 前端，Electron 是**改动最小**的"去 WebView 依赖"方案（前端代码几乎零改），但需宿主编译。

### 2.5 Flutter（含鸿蒙）

- **[未核实]** `flutter.dev` 本次未成功取到正文；HarmonyOS 侧的 Flutter/ArkUI 支持请参见同团队 `research/01-huawei-base-tech.md`（OpenHarmony/ArkUI/ArkTS）。
- **[分析]** Flutter 自绘引擎，不依赖系统 WebView；但**无法复用 Vue 前端**，且国内鸿蒙版本由 OpenHarmony 社区/华为维护（`flutter_flutter` 荣誉分支，本次未取得来源）。属于"重写"路线。

### 2.6 是否存在"纯国产桌面框架"

- **[未能核实]** 本次未检索到被广泛采用的、可替代 Wails/Tauri/Electron 的"纯国产跨平台桌面框架"一手证据。国内多为**基于既有框架的发行版/适配层**（如 Qt 的商业发行、Electron 的国产化封装），而非全新自研框架。**不排除存在小众项目，但缺乏可靠来源，本报告不列名。**

### 2.7 选型建议（供汇总报告参考）

| 方案 | 是否依赖系统 WebView | 复用现有 Vue3 前端 | 国产 OS 适配难度 | 结论 |
|---|---|---|---|---|
| Wails v3（保持） | 是（WebKitGTK） | 完全复用 | 中（需 4.0 ABI 适配，项目已做） | **首选：改动最小** |
| Tauri 2 | 是（WebKitGTK） | 可复用（需换壳） | 中 | 不推荐（不解决根因） |
| Electron | 否（自带 Chromium） | 几乎零改 | 低-中 | **次选：彻底规避 WebView** |
| Qt | 否（自绘/自带 WebEngine） | 否（需重写） | 低 | 备选（信创主流，成本高） |
| Flutter | 否（自绘） | 否（需重写） | 中 | 备选（若需鸿蒙） |

---

## 3. 国产 UI 组件库

- **[已核实]** **OpenTiny / tiny-vue**（opentiny/tiny-vue）：Gitee 仓库描述为"一套**跨端、跨框架**的企业级 UI 组件库，支持 **Vue 2 和 Vue 3**，支持 **PC 端和移动端**"，主页 `https://opentiny.design/tiny-vue`。
  > 来源：[tiny-vue - Gitee](https://gitee.com/opentiny/tiny-vue)
  > 来源：[OpenTiny 官网](https://www.opentiny.design/)
- **[已核实]** **Arco Design**：官网定位"企业级产品的完整设计和开发解决方案"（字节跳动开源）。
  > 来源：[Arco Design 官网](https://arco.design/)
- **[已核实]** **Semi Design**：官网定位"由**抖音前端与 UED 团队**维护，易于定制的现代化设计系统"，React 组件库，官网显示 GitHub 9.9k。
  > 来源：[Semi Design 官网](https://semi.design/)
- **[已核实]** **Ant Design**：Gitee 仓库描述"一套企业级 UI 设计语言和 React 组件库"。
  > 来源：[ant-design - Gitee](https://gitee.com/ant-design/ant-design)
- **[未能核实]** **TDesign（腾讯）**：官网 `tdesign.tencent.com` 本环境超时，未能取得一手资料；仓库页抓取未获正文。

**[分析] 与 Element Plus 的替代关系：**

- 项目当前用 **Element Plus（Vue 3）**。在"国产化"口径下，**OpenTiny / tiny-vue 是最直接的国产对标**（同为 Vue 3、企业级、PC+移动端），是唯一本次可核实的、可几乎同构替换 Element Plus 的国产库。
- **Ant Design / Semi Design 为 React 库**，Arco Design 虽有 Vue 版但本次未核实到 Vue 仓库正文；它们与本项目 **Vue 3 技术栈不匹配**，替换等于换框架，成本极高。
- **重要提示**：Element Plus 组件库本身是**纯前端 npm 包，不涉及"是否国产"的运行风险**；UI 组件库替换的主要动机是"信创形象/合规"而非技术必需。若项目已通过按需引入优化体积（见项目 OPTIMIZATION_PLAN），替换收益有限、回归风险高。

| 组件库 | 技术栈 | 是否可核实 | 与 Element Plus 替换成本 | 评级 |
|---|---|---|---|---|
| OpenTiny / tiny-vue | Vue 2/3，PC+移动 | ✅ | 中（API 差异大，需逐组件迁移） | **可选国产替代** |
| Arco Design | React（Vue 版未核实） | ✅（主体） | 高 | 有条件 |
| Semi Design | React（抖音） | ✅ | 高（需换框架） | 不适用 |
| Ant Design | React | ✅ | 高（需换框架） | 不适用 |
| TDesign | 多框架（未核实） | ❌ | 未知 | 未能核实 |

---

## 4. 国密算法与密码库

### 4.1 国密算法标准（SM2/SM3/SM4/SM9）

- **[说明]** 国密算法为公开的国家/行业标准，常见对应关系为：**SM2**（椭圆曲线公钥密码，GB/T 32918 系列）、**SM3**（密码杂凑，GB/T 32905）、**SM4**（分组密码，GB/T 32907）、**SM9**（标识密码）。上述**标准编号属公开常识，但本次未能联网取得官方标准原文**，故仅作参考，正式合规请以国家密码管理局发布文本为准。

### 4.2 铜锁 Tongsuo（原 BabaSSL）

- **[已核实]** 铜锁官方文档站可访问，文档目录中出现 **"BabaSSL API"**、**"在 TLS1.3 中使用商用密码算法"**、**"使用铜锁签发 SM2 双证书"**、**"NTLS 使用手册"**、**"使用 Tongsuo 签发 SM2 证书"**、**"应用程序使用铜锁证书压缩功能"** 等条目——证明铜锁是 **OpenSSL 的国密增强分支**，原名 **BabaSSL**，支持 SM2 双证书、国密 TLS（NTLS）与 TLS1.3 商用密码套件。
  > 来源：[Tongsuo 文档（BabaSSL API 等）](https://tongsuo.readthedocs.io/zh_CN/stable/)
- **[未能核实]** 铜锁官网 `tongsuo.net` 被 CDN 403 拦截；维护方主体（蚂蚁集团/阿里）与具体版本号本次未取得一手确认，故不列版本号。
- **[定位]** 铜锁面向**服务端/TLS 层**（如国密 HTTPS、网关），**与桌面客户端内部数据加密（如本项目凭据存储）不是同一层次**，直接替换 Go 标准库 AES 的场景有限；主要用于需要国密 TLS 通信的场景。

### 4.3 GmSSL

- **[已核实]** GmSSL 官方 README（Gitee 镜像 `mirrors/GmSSL`）："GmSSL 是**由北京大学自主开发的国产商用密码开源库**，实现了对国密算法、标准和安全通信协议……"；其 CI 徽章包含 **OpenHarmony（ohos）**、Android、iOS 等平台构建。
  > 来源：[GmSSL - Gitee 镜像 README](https://gitee.com/mirrors/GmSSL)
- **[未能核实]** GmSSL 官网 `gmssl.cn` 超时。

### 4.4 Go 国密库（tjfoc/gmsm）

- **[已核实]** Gitee 镜像 `mirrors_tjfoc/gmsm` README 明确："**GM SM2/3/4 library based on Golang（基于 Go 语言的国密 SM2/SM3/SM4 算法库）**"，功能包括：
  - **SM2**：生成密钥、签名/验签、加解密、PEM 证书读写、证书链、`crypto.Signer` 接口；
  - **SM3**：`sm3Sum`、`hash.Hash` 接口；
  - **SM4**：生成密钥、加解密，提供 **`Cipher.Block` 接口**，支持 PEM block 加密。
  > 来源：[gmsm - Gitee 镜像 README](https://gitee.com/mirrors_tjfoc/gmsm)
- **[分析]** 由于 gmsm 的 SM4 实现了标准 `cipher.Block` 接口，理论上可无缝接入 Go 标准库 `cipher.NewGCM(...)`，**使 SM4-GCM 成为现有 AES-GCM 的近似"同构替换"**。

### 4.5 项目现有加密实现（迁移前提）

**[已核实·项目源码]**

| 位置 | 算法 | 用途 |
|---|---|---|
| `backend/credentials/crypto.go` | **AES-256-GCM**，随机 nonce，密文前缀 `enc:v1:` | 凭据（密码/密钥）字段级加密 |
| `backend/sync/crypto.go` | **AES-GCM**（`encryptBytesWithAAD` / `decryptBytesWithAAD`，带 AAD 绑定文件标识） | 云同步文件（connections.json.enc / settings.json.enc 等）加密 |
| `backend/sync/keychain.go` | **PBKDF2-SHA256，600000 迭代，派生 32 字节 AES-256 密钥**（`DeriveKey`） | 主密码 → 加密密钥 |
| `backend/importer/{navicat,windterm,dbeaver}.go` | **AES-CBC/固定密钥** | 仅用于**导入第三方软件**（Navicat/WindTerm/DBeaver）的数据格式兼容 |
| 前端 | **无本地 AES 加密逻辑**（加密全部在后端）；依赖 `github.com/zalando/go-keyring` 访问系统密钥链 | — |

> 来源：项目 `backend/credentials/crypto.go`、`backend/sync/crypto.go`、`backend/sync/keychain.go`、`frontend/package.json`

### 4.6 国密替换方案（AES → SM4 的具体迁移路径）

**结论：后端替换可行且改动集中，但必须做"版本化 + 双读兼容"，不能一把替换。**

**(1) 后端凭据加密（推荐替换）**
- 新增 `backend/crypto/sm4` 封装，使用 `github.com/tjfoc/gmsm/sm4` 提供的 `cipher.Block`，接入 `cipher.NewGCM`，产出 **SM4-GCM** 密文。
- 密文前缀由 `enc:v1:` 升级为 **`enc:sm4:v1:`**；解密函数同时识别 `enc:v1:`（AES）与 `enc:sm4:v1:`（SM4），实现**平滑迁移**：老数据首读时用 AES 解密后立即用 SM4 重写（惰性重加密）。
- GCM 的 nonce 长度、AAD 语义保持不变即可复用现有封装结构。

**(2) 云同步加密（推荐替换）**
- `encryptBytesWithAAD` / `decryptBytesWithAAD` 增加算法分支：写入用 SM4-GCM，读取按密文头/元数据区分。
- 因同步数据参与 Git 提交与跨设备/跨版本，**必须保留 AES 读取能力至少一个大版本**，否则旧客户端无法解密。

**(3) 密钥派生（KDF）**
- 现有 **PBKDF2-SHA256（600000 迭代）** 属合规的 KDF，**国密并不强制 KDF 使用 SM3**；若密评要求全栈国密，可用 **PBKDF2-HMAC-SM3**（需自行基于 gmsm 的 SM3 实现 PBKDF2，Go 标准库无 SM3 版 PBKDF2），或改用 GM/T 系列 KDF。**KDF 变更会改变派生密钥，必须与密文格式一起做版本化迁移。**
- 注意：`crypto/sha256` 在 `DirHash`（数据目录作用域哈希）中亦有使用，该处**与加密无关**，无需替换。

**(4) 第三方导入器（不可替换）**
- `backend/importer/*` 的 AES-CBC 是**逆向/兼容 Navicat、WindTerm、DBeaver 的私有格式**，算法与密钥由对方定义，**不能改为 SM4**，否则无法读取这些软件的导出数据。应保持原样。

**(5) 前端**
- 项目当前**前端无 AES 逻辑**，故前端国密替换基本无工作量。若未来前端需要本地加解密，可引入 JS 国密库（如基于 sm-crypto / gm-crypt 一类第三方库）；**本次未能核实这些具体库的仓库与活跃度，故不列名、不背书**。

**(6) 兼容风险清单**
- 版本降级：用户在 SM4 加密后回退旧版本将无法解密 → 需在发布说明中声明"升级不可逆"。
- 云同步多端：不同版本客户端混用同一同步仓库会冲突 → 建议同步格式带 `cipher` 元数据字段。
- 国密 TLS：若还需国密通信（如调用国密网关），属于**另一条线**，需引入铜锁/GmSSL 或国密 OpenSSL，与本项目"客户端本地存储加密"是两件事。

### 4.7 国密方案成熟度评级

| 方案 | 用途 | 可核实 | 评级 | 说明 |
|---|---|---|---|---|
| `tjfoc/gmsm`（Go） | 客户端本地 SM2/3/4 | ✅ | **可信** | 提供 `cipher.Block`，可接 SM4-GCM |
| 铜锁 Tongsuo | 服务端/国密 TLS | ✅（文档） | **可信（限于 TLS 场景）** | 不直接用于客户端存储加密 |
| GmSSL（北大） | C 库/协议/OHOS | ✅（README） | **可信** | 需 CGO/FFI 集成，Go 侧非首选 |
| Java BouncyCastle 国密 | JVM 生态 | ❌ | **未能核实** | 与本项目（Go）无关，未取证 |

---

## 5. 国产终端 / SSH 工具与国密 SSH

### 5.1 国产 SSH / 终端客户端

- **[已核实]** **FinalShell**（hostbuf.com）当前版本 **4.6.3，更新日期 2025.5.21**，官方描述为"SSH 工具、服务器管理、远程桌面加速软件，支持 **Windows、macOS、Linux**"。官网同时提示"请勿使用修改版、破解版、补丁，极可能造成信息泄露"。
  > 来源：[FinalShell 官网](https://www.hostbuf.com/)
- **[分析]** FinalShell 是国内使用较广的 SSH/终端客户端，但：
  1. 其官网未宣称"信创适配/国密支持"（本次页面未见相关表述）；
  2. 与 uniTerm 的关系是**竞品/参考对象**，而非可复用的替代组件；
  3. 本报告无法核实其是否通过信创认证。
- **[未能核实]** 是否另有通过信创认证的国产 SSH 客户端（如某些安全厂商加固版），本次未取得可靠一手来源，不列名。

### 5.2 国密 SSH

- **[未能核实]** 本次未能取得关于"国密 SSH（SM2/SM3/SM4 用于 SSH 协议）"的**标准化一手资料**（如具体 RFC 编号或国标号）。铜锁/GmSSL 的国密能力集中在 **TLS（NTLS）**，并不等于 SSH 国密。
- **[分析]** 现有 OpenSSH / golang.org/x/crypto/ssh（本项目 SSH 栈）默认不支持 SM2/SM3/SM4。若目标环境要求"国密 SSH"，需使用**国密改造版 OpenSSH 或专用国密 SSH 库**，本项目需替换/桥接 SSH 实现——**这是一项实打实的难点，且缺乏公开标准化依据，风险高。**
- **[结论]** 在信创落地中，"SSH 通道本身国密化"应作为**独立课题**评估，不建议在现有 SSH（x/crypto/ssh）基础上轻率宣称已支持国密。

---

## 6. 信创名录与适配认证要求

- **[已核实]** 麒麟提供面向合作伙伴的**适配申请与适配证书查询**流程，并设有"生态标准规范""生态联盟"。
  > 来源：[生态兼容清单 - 麒麟软件](https://www.kylinos.cn/eco/ecoSearch/compatibleList/index.html)
- **[已核实]** openKylin 提供"兼容适配规范、兼容适配列表、兼容适配申请"，以及"软件上架声明"。
  > 来源：[兼容适配 - openKylin](https://www.openkylin.top/support/)
- **[厂商宣传]** 银河麒麟 V11 页面宣称通过"商密 / 等保 / 行标认证"；这是**操作系统自身**的认证，不自动赋予其上的第三方应用。
  > 来源：[银河麒麟桌面操作系统V11](https://www.kylinos.cn/productPc/desktop/desktopMainV11/)
- **[未能核实]** **"信创产品目录/名录"的具体条目与证书编号**：本次未找到可公开访问、且权威的"信创名录"在线查询入口。业内所说的"信创目录"通常由各级党政/行业主管部门按批次发布，多为**非公开或半公开**，第三方难以在线核实。**本报告不编造任何目录名称、批次或证书号。**
- **[分析]** 对 uniTerm 这类**工具型桌面应用**，现实路径通常是：
  1. 通过 OS 厂商（麒麟/统信）的**生态适配互认证**（提交适配申请、测试、获取适配证书）；
  2. 通过**等保 2.0**（若涉政企信息系统）与可能的**商用密码应用安全性评估（密评）**；
  3. 进入客户侧的软件正版化/信创采购清单（由客户与主管部门决定，非产品自证）。
  上述流程的具体材料、周期、费用**本次均未能取得一手来源**，需在立项时向厂商/评测机构直接确认。

---

## 7. 国产浏览器内核 / WebView

- **[已核实]** 奇安信官网、360 浏览器官网本环境返回 HTTP 200（站点可达）。
  > 来源：[奇安信官网](https://www.qianxin.com/)
  > 来源：[360 浏览器官网](https://browser.360.cn/)
- **[未能核实]** **红莲花浏览器** `redlotus.cn` 返回 HTTP 403，**华为 ArkWeb**、**360 安全浏览器内核**、**奇安信可信浏览器内核**的**具体内核版本与技术细节**本次均未能取得一手资料。
- **[分析（基于公开常识，谨慎标注）]** 国产"安全浏览器"多采用 **Chromium 系内核 + 安全加固模块**，属于"外国开源内核 + 国产加固"，并非完全自研内核。华为 **ArkWeb** 是 HarmonyOS 的 Web 内核（基于 Chromium 的深度定制）。
- **对桌面应用的影响**：
  1. 这些国产浏览器/内核主要面向**浏览器场景**，**桌面应用（Wails）使用的不是这些浏览器，而是系统 WebKitGTK**——两者不是一回事，不能直接用国产浏览器内核替换 WebKitGTK。
  2. 若未来希望"应用内嵌国产安全内核"，理论路径是内嵌 Chromium/CEF 并替换为国产加固版（如某些安全厂商提供的 CEF 发行），但**是否有可商用的桌面 WebView 国产内核，本次未能核实**。

---

## 8. 信创适配技术总览表

| 技术层 | 项目现状 | 国产/信创方案 | 成熟度 | 可信性 | 迁移成本 |
|---|---|---|---|---|---|
| **操作系统** | macOS/Windows/Linux | 麒麟 V10/V11、统信 UOS、deepin 25、openKylin 3.0、openEuler | 高 | **可信**（麒麟/deepin/openKylin 已取证；UOS 官网不可达→有条件） | 低（已有 Linux 构建） |
| **桌面框架** | Wails v3（系统 WebView） | 保持 Wails（需 WebKitGTK 4.0 适配）；备选 Electron（自带 Chromium）、Qt | 中 | **可信（需适配）** | Wails 低 / Electron 中 / Qt 高 |
| **WebView** | WebKitGTK（Linux） | 无"国产 WebView"可直接替换 | 中 | **有条件可信** | —（依赖 OS 提供） |
| **前端框架** | Vue 3 + TS | 保持 Vue 3（无国产前端框架可替代） | 高 | **可信** | 无 |
| **UI 组件库** | Element Plus | OpenTiny / tiny-vue（Vue3 国产对标） | 中 | **可选**（替换非必需） | 中（逐组件回归） |
| **终端模拟** | xterm.js | 无国产替代；xterm.js 为纯前端，无国产化压力 | 高 | **可信** | 无 |
| **本地加密** | AES-256-GCM + PBKDF2-SHA256 | SM4-GCM（tjfoc/gmsm）+ SM3 KDF（可选） | 中 | **可信（可迁移）** | 中（需双读兼容） |
| **TLS/通信国密** | 标准 TLS | 铜锁 Tongsuo / GmSSL（NTLS、SM2 双证书） | 中 | **可信（TLS 场景）** | 高（另建链路） |
| **SSH** | golang.org/x/crypto/ssh | 国密 SSH 无标准化一手依据 | 低 | **不可信（证据不足）** | 高（需专用库） |
| **第三方导入兼容** | AES-CBC（Navicat/WindTerm/DBeaver） | 不可替换（外部私有格式） | — | **保持原样** | 无（禁止改动） |
| **终端/SSH 客户端（竞品）** | — | FinalShell 4.6.3（Win/mac/Linux） | 中 | **可核实产品**，信创认证未核实 | — |
| **信创名录/认证** | — | 麒麟/统信生态适配互认证 + 等保 + 密评 | 中 | **有条件可信**（流程存在，名录细节未核实） | 高（流程与周期） |
| **浏览器内核** | 系统 WebKitGTK | 红莲花/360/奇安信/华为 ArkWeb（均为 Chromium 系+加固） | 中 | **未能核实** | 不适用 |

---

## 9. 关键结论与难点提示

1. **Wails 在信创环境可行，但核心依赖是系统 WebKitGTK**，且国产旧仓库（麒麟 V10 等）WebKit 版本偏低。本项目**已具备专门的 `webkit40` 适配构建**（不带 `-tags webkit2_40` 以兼容 4.0 ABI），这是本项目信创可行性的**最强证据**。
2. **换 Tauri 不能解决问题**（同为系统 WebView）。若必须彻底摆脱 WebView 依赖，只有 **Electron（自带 Chromium，前端几乎零改）** 或 **Qt（信创主流，但需重写前端）** 两条路。
3. **国密替换是"可做但需工程化"**：本地存储加密从 AES-GCM → **SM4-GCM（tjfoc/gmsm 提供 `cipher.Block`，可直连 `cipher.NewGCM`）** 是低摩擦路径，但**密文格式必须版本化 + 双读兼容**；第三方导入器的 AES 绝对不能改。
4. **"国密 SSH"缺乏标准化一手依据**，不可轻率宣称支持；应作为独立课题。
5. **信创名录/证书号本次无法在线核实**，不编造；现实路径是 OS 厂商适配互认证 + 等保 + 密评。
6. **UI 组件库替换（Element Plus → OpenTiny）是"形象工程"而非技术必需**，收益有限、回归成本高，建议非必要不换。
7. **麒麟 V11 的磐石架构/开明包格式**是新的打包变量，其对第三方传统安装包的影响本次**未能取得一手资料**，需在目标环境实测。

---

## 10. 未能核实事项汇总（供后续补充）

| 事项 | 原因 |
|---|---|
| 统信 UOS 专业版/服务器版版本号与市场份额 | www.uniontech.com 超时 |
| 铜锁官网与维护主体、具体版本 | tongsuo.net 被 CDN 403 |
| GmSSL 官网 | gmssl.cn 超时 |
| TDesign（腾讯）组件库定位 | tdesign.tencent.com 超时 |
| 红莲花 / 华为 ArkWeb / 360 / 奇安信 内核细节 | 站点 403 / 未取得正文 |
| 信创产品目录条目与证书编号 | 无公开权威在线入口 |
| 国密 SSH 的标准/RFC 编号 | 未取得一手资料 |
| Wails 官方 Linux 依赖原文 | wails.io 触发 Cloudflare 验证 |
| 前端 JS 国密库具体选型 | 未核实，不背书 |

---

*报告完。所有 [已核实] 条目均可通过对应来源 URL（或本地仓库文件）复核；[厂商宣传] 与 [未能核实] 条目不得作为技术决策的唯一依据。*