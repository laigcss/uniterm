# 国产化替代评估报告严谨性评审意见

> **评审对象**：`/Users/laigc/Documents/huawei_project/uniTerm/DOMESTIC_SUBSTITUTION_ASSESSMENT.md`
> **评审员**：国产化替代评估报告严谨性评审员（task 44）
> **评审日期**：2026-10-12
> **评审方法**：逐条交叉核对报告结论与五份调研源文件（`research/00`～`research/04`）

---

## 1. 评审概况

| 项 | 值 |
|----|----|
| 报告行数 | 724 行 |
| 报告字节数 | 58,495 字节 |
| 覆盖技术层数 | 18 层（芯片/OS/语言/编译器/桌面框架/前端UI/终端模拟/数据库×7/中间件/容器K8s/对象存储/AI/加密/SSH） |
| 源文件数 | 5 份（00-project-deps、01-huawei-base-tech、02-domestic-database、03-domestic-middleware、04-xinchuang-adaptation） |
| 核查结论条目数 | 18 个技术层 + 10 条夸大警示 + 32 条未能核实事项 |
| **总体评价** | **通过**（有 2 处低严重度措辞/遗漏可优化，不影响实质结论） |

---

## 2. 逐项核查

### 2.1 芯片/指令集层（报告 §3.1）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 1 | 鲲鹏 920（ARMv8）产品线真实 | 01-huawei-base-tech.md §4.1（鲲鹏社区官网，"鲲鹏920新型号开发指导"） | ✅有据 | — |
| 2 | 飞腾腾锐/腾云（ARM）产品线 | 01-huawei-base-tech.md §4.2（飞腾官网实测产品清单 S5000C/D3000/E2000 等） | ✅有据 | — |
| 3 | 龙芯 3A6000/3C6000（LoongArch 自主指令集） | 01-huawei-base-tech.md §4.3（龙芯官网实测 3A5000/3A6000/3C6000） | ✅有据 | — |
| 4 | 海光（x86 生态） | 01-huawei-base-tech.md §4.4（官网 SPA，行业公开认知 x86） | ✅有据 | 报告如实标注"参数未能取证" |
| 5 | 兆芯开先/开胜（x86 生态） | 01-huawei-base-tech.md §4.5（兆芯官网实测"开先系列""开胜 KH-50000"） | ✅有据 | — |
| 6 | Go 官方支持 loong64 | 01-huawei-base-tech.md §4.6（Go 官方下载页实测出现 loong64） | ✅有据 | — |
| 7 | 成熟度生产级、迁移成本低 | 01-huawei-base-tech.md §4.7（"党政/金融/运营商批量交付""最务实最易落地"） | ✅有据 | — |

### 2.2 操作系统层（报告 §3.2）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 8 | openEuler 26.09 创新版 / 24.03 LTS SP4 | 01-huawei-base-tech.md §3.1（官网下载页实测发布日期与内核版本） | ✅有据 | — |
| 9 | openEuler 支持 x86_64/aarch64/ARM32/RISC-V/LoongArch/PowerPC/SW-64 | 01 §3.1 + 04-xinchuang-adaptation.md §1.5（两处来源综合） | ✅有据 | — |
| 10 | 银河麒麟 V10/V11 磐石架构/开明包格式 | 04-xinchuang-adaptation.md §1.1（麒麟官网实测 V11 页面） | ✅有据 | 报告如实标注开明包影响"未能核实" |
| 11 | openKylin 3.0 / deepin 25 / 统信 UOS | 04-xinchuang-adaptation.md §1.2-1.4（各官网实测） | ✅有据 | UOS 专业版如实标注"未能核实" |
| 12 | 项目已有 webkit40 适配构建（Kylin V10/RHEL 8/openEuler） | 04-xinchuang-adaptation.md §1.6（项目 .github/workflows/build-linux-webkit40.yml 原文引用） | ✅有据 | 报告称"最强证据"，源文件亦如此定位 |

### 2.3 编程语言层 — 仓颉 Cangjie（报告 §3.3）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 13 | 仓颉 STS 1.2.0 / LTS 1.0.5，已开源 Apache-2.0 | 01-huawei-base-tech.md §1.2-1.3（官网版本下拉实测 + GitCode 开源） | ✅有据 | — |
| 14 | 鸿蒙版"内测及试点商用" | 01-huawei-base-tech.md §1.3（GitCode Cangjie 组织 README 原文） | ✅有据 | — |
| 15 | 三方生态已有 redis-sdk/opengauss-driver/OBS SDK 等 | 01-huawei-base-tech.md §1.4（TPC-Resource 实测清单） | ✅有据 | — |
| 16 | 生态缺口：SSH/SFTP/SCP/VNC/RDP/PTY+VT/MongoDB/ES 全部缺失 | 01-huawei-base-tech.md §1.4（"实测清单中未出现"逐条列出） | ✅有据 | — |
| 17 | 成熟度"早期→成熟中"，"全场景/高性能/原生智能化"属宣传话术 | 01-huawei-base-tech.md §1.6（明确区分宣传与实际） | ✅有据 | 报告与源文件一致区分宣传 |
| 18 | 迁移成本"不可行"，长期 3-5 年观察项 | 01-huawei-base-tech.md §1.6（"不能作为现成方案，最多长期观察项"） | ✅有据 | — |

### 2.4 编译器层（报告 §3.4）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 19 | 毕昇 JDK = OpenJDK 定制版，支持 AArch64/x86_64 | 01-huawei-base-tech.md §5.1（Gitee bishengjdk-8 README 原文） | ✅有据 | — |
| 20 | 毕昇 C/C++ 编译器未能核实 | 01-huawei-base-tech.md §5.2（gitee.com/openeuler/bisheng-compiler 返回 404） | ✅有据 | — |
| 21 | 方舟编译器仅限 OpenHarmony，"替代 GCC/LLVM"属夸大宣传 | 01-huawei-base-tech.md §2.4、§5.3（arkcompiler_runtime_core + 明确标注夸大） | ✅有据 | — |
| 22 | 仓颉编译器基于 LLVM | 01-huawei-base-tech.md §1.3（llvm-project fork） | ✅有据 | — |

### 2.5 桌面框架层（报告 §3.5）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 23 | Wails v3.0.0-beta.16，Go + 系统 WebView | 04-xinchuang-adaptation.md §2.1（项目 go.mod/package.json 确认） | ✅有据 | — |
| 24 | Tauri 2 同为系统 WebView，不解决根因 | 04-xinchuang-adaptation.md §2.2（Tauri 官网 + 架构分析） | ✅有据 | — |
| 25 | Electron 自带 Chromium，前端几乎零改但体积大 | 04-xinchuang-adaptation.md §2.4 | ✅有据 | — |
| 26 | Qt 自绘/信创主流，需重写前端 | 04-xinchuang-adaptation.md §2.3（Qt 官网 + 分析） | ✅有据 | — |
| 27 | Flutter 自绘，无法复用 Vue | 04-xinchuang-adaptation.md §2.5 | ✅有据 | — |
| 28 | 无纯国产桌面框架 | 04-xinchuang-adaptation.md §2.6（"未检索到一手证据，不列名"） | ✅有据 | — |

### 2.6 前端框架与 UI 组件层（报告 §3.6）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 29 | ArkTS 基于 TS 扩展，自 API 10 强化静态检查 | 01-huawei-base-tech.md §2.2（OpenHarmony docs 原文） | ✅有据 | — |
| 30 | ArkUI 声明式开发，需重写 94 个组件，仅限 HarmonyOS | 01-huawei-base-tech.md §2.3、§2.6（"重写全部 94 个组件""仅能运行于 HarmonyOS"） | ✅有据 | — |
| 31 | OpenTiny/tiny-vue 是唯一可核实的 Vue3 国产对标 | 04-xinchuang-adaptation.md §3（Gitee 仓库实测"跨端跨框架 Vue2/3"） | ✅有据 | — |
| 32 | Ant Design / Semi Design 为 React 库，不匹配 Vue3 | 04-xinchuang-adaptation.md §3 | ✅有据 | — |
| 33 | TDesign 官网超时未能核实 | 04-xinchuang-adaptation.md §3（tdesign.tencent.com 超时） | ✅有据 | — |
| 34 | UI 组件库替换是"形象工程"而非技术必需 | 04-xinchuang-adaptation.md §3、§9（"替换收益有限、回归风险高"） | ✅有据 | — |

### 2.7 终端模拟层（报告 §3.7）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 35 | xterm.js 纯前端，无国产化压力 | 00-project-deps.md（@xterm/xterm ^6.0.0 标注"无成熟国产替代"） | ✅有据 | — |
| 36 | 仓颉缺失终端 PTY + VT/ANSI 解析 | 01-huawei-base-tech.md §1.4 | ✅有据 | — |

> ⚠️ **措辞不一致**：报告 §1.2 速览表第 16 行"终端模拟"可信性标"**不可信**"（指国产替代方案不可信），而 §3.7 可信性等级标"**可信**"（指保持 xterm.js 可信）。两处语义不同但表头同名"可信性"，易引起混淆。详见问题清单 #1。

### 2.8 数据库层（报告 §3.8）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 37 | MySQL → TiDB，改 DSN 即可，驱动不变 | 02-domestic-database.md §2.3（TiDB 官方"高度兼容 MySQL 协议"） | ✅有据 | — |
| 38 | PG → openGauss，需换官方 fork 驱动（SHA256/SM3 认证） | 02-domestic-database.md §2.1（openGauss-connector-go-pq Gitee 仓库） | ✅有据 | — |
| 39 | Oracle → 达梦 DM，需重写模块 + SQL 方言适配 | 02-domestic-database.md §2.5（达梦自有协议，Go 驱动 GO_DM） | ✅有据 | — |
| 40 | SQL Server 无直接国产对应 | 02-domestic-database.md §5（"无直接国产对应"） | ✅有据 | — |
| 41 | Redis → 阿里云 Tair / 腾讯云 Tair，RESP 兼容 | 02-domestic-database.md §2.10（官方"兼容 Redis，无需修改代码"） | ✅有据 | — |
| 42 | MongoDB → SequoiaDB，协议兼容待实测 | 02-domestic-database.md §2.11（官网定位 + "未能核实协议兼容性"） | ✅有据 | 报告如实标注"待实测" |
| 43 | ES → Easysearch，改 baseUrl 即可 | 02-domestic-database.md §2.12（"兼容 ES 索引至 6.x""业务代码不需要调整"） | ✅有据 | — |
| 44 | provider 插件式架构，协议兼容则低成本 | 02-domestic-database.md §1.2（provider.go 定义统一接口） | ✅有据 | — |
| 45 | OceanBase MySQL 模式 / TDSQL / PolarDB / GBase 作为备选 | 02-domestic-database.md §2.4、§2.8、§2.9、§2.7 | ✅有据 | — |
| 46 | 华为 GaussDB/GeminiDB/CloudSearch 未能核实 | 02-domestic-database.md §2.2、§9（官网反爬，明确标注） | ✅有据 | — |
| 47 | "兼容 Oracle" ≠ 兼容协议，达梦/OceanBase 宣传口径需警惕 | 02-domestic-database.md §8（"语法兼容≠协议兼容"明确警示） | ✅有据 | — |

### 2.9 中间件层（报告 §3.9）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 48 | ShardingSphere 过度设计 | 03-domestic-middleware.md §3.1（"无关联/过度设计"） | ✅有据 | — |
| 49 | RocketMQ 过度设计（可增强间接） | 03-domestic-middleware.md §3.2 | ✅有据 | — |
| 50 | Dubbo 过度设计 | 03-domestic-middleware.md §3.3 | ✅有据 | — |
| 51 | ServiceComb 过度设计，Go 支持未核实 | 03-domestic-middleware.md §3.4（"有条件可信"） | ✅有据 | — |
| 52 | SkyWalking 可增强（Go agent） | 03-domestic-middleware.md §3.5 | ✅有据 | — |
| 53 | Seata 过度设计，Apache 孵化中非 TLP | 03-domestic-middleware.md §3.6（"成熟中""有条件可信"） | ✅有据 | — |
| 54 | ShenYu 过度设计 | 03-domestic-middleware.md §3.7 | ✅有据 | — |
| 55 | 服务端中间件对桌面终端工具属过度设计 | 03-domestic-middleware.md §6.1（专节论述） | ✅有据 | — |

### 2.10 容器与 K8s 层（报告 §3.10）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 56 | iSulad 需适配 CLI（isula 与 docker CLI 不完全兼容） | 03-domestic-middleware.md §3.10（"不能零修改接入"） | ✅有据 | — |
| 57 | KubeSphere 兼容 K8s REST API 可直连 | 03-domestic-middleware.md §3.8（"CNCF 认证容器平台"） | ✅有据 | — |
| 58 | KubeEdge CNCF graduated，边缘场景 | 03-domestic-middleware.md §3.11（"CNCF graduated（已毕业）"） | ✅有据 | — |
| 59 | Volcano CNCF 孵化，AI 调度 | 03-domestic-middleware.md §3.9（"华为主导并捐赠至 CNCF（孵化中）"） | ✅有据 | — |
| 60 | K8s 模块为手写 REST 客户端（非 client-go） | 03-domestic-middleware.md §2.2（go.mod grep k8s.io 返回 0 结果） | ✅有据 | — |
| 61 | 容器模块为 CLI 调用（非 Docker SDK），已支持 podman/nerdctl | 03-domestic-middleware.md §2.3（provider.go Runtime 枚举实测） | ✅有据 | — |

### 2.11 对象存储层（报告 §3.11）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 62 | 华为 OBS / 阿里 OSS / 腾讯 COS 兼容 S3，改 endpoint 即可 | 03-domestic-middleware.md §3.14-3.16（各产品页确认 S3 兼容） | ✅有据 | — |
| 63 | MinIO 非国产（美国公司 Redwood City, CA） | 03-domestic-middleware.md §3.12（明确标注"非国产"） | ✅有据 | — |
| 64 | Ceph 非国产，过度设计 | 03-domestic-middleware.md §3.13（"Red Hat/社区""无关联/过度设计"） | ✅有据 | — |

### 2.12 AI 框架层（报告 §3.12）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 65 | MindSpore 2.10（含 Lite、Transformers） | 01-huawei-base-tech.md §6.1（官网安装页实测） | ✅有据 | — |
| 66 | 与 PyTorch 差距明显（算子/模型/社区） | 01-huawei-base-tech.md §6.2 | ✅有据 | — |
| 67 | 关联度中低，现有云端 API 路径更实用 | 01-huawei-base-tech.md §6.3（"关联度中低""属新增能力而非替代"） | ✅有据 | — |
| 68 | 昇腾/CANN 面向 AI 算力，与桌面应用关联度极低 | 01-huawei-base-tech.md §7.3（"桌面场景几乎不现实"） | ✅有据 | — |

### 2.13 加密与国密层（报告 §3.13）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 69 | 现有 AES-256-GCM + PBKDF2-SHA256（600000 迭代） | 04-xinchuang-adaptation.md §4.5（项目源码逐文件确认） | ✅有据 | — |
| 70 | tjfoc/gmsm 提供 SM4 cipher.Block，可接 SM4-GCM | 04-xinchuang-adaptation.md §4.4（Gitee 镜像 README 确认） | ✅有据 | — |
| 71 | 铜锁 Tongsuo（原 BabaSSL）面向 TLS 层 | 04-xinchuang-adaptation.md §4.2（文档站实测 BabaSSL API/NTLS） | ✅有据 | — |
| 72 | GmSSL（北大）需 CGO/FFI，Go 侧非首选 | 04-xinchuang-adaptation.md §4.3（Gitee 镜像 README 确认） | ✅有据 | — |
| 73 | 迁移路径：密文前缀 enc:v1: → enc:sm4:v1:，双读兼容 | 04-xinchuang-adaptation.md §4.6（详细迁移路径） | ✅有据 | — |
| 74 | 第三方导入器 AES-CBC 不可替换 | 04-xinchuang-adaptation.md §4.6（"外部私有格式，不能改为 SM4"） | ✅有据 | — |

### 2.14 SSH 与终端协议层（报告 §3.14）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 75 | 国密 SSH 无标准化一手依据 | 04-xinchuang-adaptation.md §5.2（"未能取得标准化一手资料"） | ✅有据 | — |
| 76 | 铜锁/GmSSL 国密能力集中在 TLS，不等于 SSH 国密 | 04-xinchuang-adaptation.md §5.2 | ✅有据 | — |
| 77 | FinalShell 4.6.3 为竞品，非可复用替代组件 | 04-xinchuang-adaptation.md §5.1（hostbuf.com 实测） | ✅有据 | — |

### 2.15 关键实现事实（报告 §2.2）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 78 | Go 后端 53,746 行 + Vue3/TS 前端 81,648 行 + 94 组件 | 00-project-deps.md（文件头确认） | ✅有据 | — |
| 79 | Go 1.26.2，module github.com/ys-ll/uniterm | 00-project-deps.md + 03-domestic-middleware.md §2.1 | ✅有据 | — |
| 80 | K8s 模块手写 REST、容器 CLI 调用、ES 自研 REST、加密 AES-GCM、已有 OS 适配、provider 架构、Git 同步 | 03 §2.2-2.4 + 04 §1.6/§4.5 + 02 §1 | ✅有据 | 7 条关键事实全部可溯源 |

### 2.16 夸大宣传警示（报告 §6）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 81 | §6.1 仓颉生态关键库缺失，切勿宣传为"现成替代" | 01-huawei-base-tech.md §1.4、§10.2 | ✅有据 | — |
| 82 | §6.2 "兼容 Oracle" ≠ 兼容协议 | 02-domestic-database.md §8 | ✅有据 | — |
| 83 | §6.3 MinIO 非国产 | 03-domestic-middleware.md §3.12、§6.2 | ✅有据 | — |
| 84 | §6.4 方舟编译器非通用编译器 | 01-huawei-base-tech.md §5.3、§10.2 | ✅有据 | — |
| 85 | §6.5 国密 SSH 缺乏标准化依据 | 04-xinchuang-adaptation.md §5.2 | ✅有据 | — |
| 86 | §6.6 OpenHarmony 作桌面平台属过度延展 | 01-huawei-base-tech.md §2.5、§10.2 | ✅有据 | — |
| 87 | §6.7 华为云商用产品官网反爬，证据缺失 | 02-domestic-database.md §2.2、§9 | ✅有据 | — |
| 88 | §6.8 服务端中间件过度设计 | 03-domestic-middleware.md §6.1 | ✅有据 | — |
| 89 | §6.9 UI 组件库替换是"形象工程" | 04-xinchuang-adaptation.md §3、§9 | ✅有据 | — |
| 90 | §6.10 麒麟 V11 磐石架构/开明包不确定性 | 04-xinchuang-adaptation.md §1.6、§9 | ✅有据 | — |

### 2.17 未能核实事项汇总（报告 §7）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 91 | 32 项未能核实事项（§7.1-7.4） | 01 附录 B + 02 §9 + 03 §七 + 04 §10 | ✅有据 | 逐条核对，全部可在源文件中找到对应 |

### 2.18 迁移路线图（报告 §5）

| 序号 | 报告结论 | 源文件依据 | 判定 | 备注 |
|:---:|---------|-----------|:----:|------|
| 92 | 短期 S1-S4（CPU 多架构/OS 适配/DB 驱动替换/对象存储） | 01 §10.1 + 02 §5 + 03 §5.1 | ✅有据 | 均为低风险基础落地 |
| 93 | 中期 M1-M5（国密/PG-Oracle PoC/iSulad/K8s/MongoDB PoC） | 04 §4.6 + 02 §5 + 03 §3.10 | ✅有据 | 需工程化但路径清晰 |
| 94 | 长期 L1-L4（仓颉/国密 SSH/MindSpore/信创认证） | 01 §10.1 + 04 §5.2/§6 | ✅有据 | 标注为观察项，不建议当前投入 |

---

## 3. 发现的问题清单

| 序号 | 问题类型 | 描述 | 严重度 | 修正建议 |
|:---:|---------|------|:------:|---------|
| 1 | 措辞不严谨 | §1.2 速览表第 16 行"终端模拟"可信性标"**不可信**"（指国产替代方案不可信），而 §3.7 可信性等级标"**可信**"（指保持 xterm.js 可信）。两处表头同名"可信性"但语义不同，易引起读者混淆。 | 低 | 建议统一口径：速览表"可信性"列统一指代"国产替代方案可信性"，则 §3.7 应改为"不可信（无成熟国产替代）"或"不适用（保持现状）"；或在速览表表头加注"（国产替代）"以消歧义。 |
| 2 | 遗漏（轻微） | 源文件 04-xinchuang-adaptation.md §7"国产浏览器内核 / WebView"一节在报告主体 §3 逐层评估中未作为独立技术层列出。该节讨论了红莲花/360/奇安信/华为 ArkWeb 等国产浏览器内核，结论是"桌面应用（Wails）使用系统 WebKitGTK 而非这些浏览器内核，不构成直接替代"。报告 §7 未能核实事项中提及了内核细节未核实，但主体评估缺少该层的正式定位。 | 低 | 建议在 §3.5 桌面框架层或 §3.7 终端模拟层后补一段"浏览器内核/WebView 层"说明：国产安全浏览器多为 Chromium 系+加固，与 Wails 使用的系统 WebKitGTK 不是同一层次，不构成独立替代层。或在 §3 增加一个简短小节定位此结论。 |

> **说明**：经逐条交叉核对，报告中 **未发现** 凭空捏造的技术/版本号/库名/URL，**未发现** 将官方宣传话术当作事实结论的情况，**未发现** 成熟度判断夸大，**未发现** 迁移成本估算明显不合理之处。所有结论均可在五份源文件中找到明确支撑，来源 URL 可追溯。报告严格区分了"官方宣传"与"实际生产可用"，对未能核实事项均明确标注且未编造内容。

---

## 4. 总体评价与建议

### 4.1 总体评价

**通过。**

本报告严谨性处于**高水平**，具体表现：

1. **来源可追溯**：每条关键结论均附来源（源文件章节号 + URL），经逐条核对全部可在源文件中找到明确支撑。
2. **无凭空捏造**：报告中出现的技术名称、版本号（Wails v3.0.0-beta.16、Go 1.26.2、MindSpore 2.10、仓颉 STS 1.2.0/LTS 1.0.5 等）、库名（tjfoc/gmsm、simples3、go-sql-driver/mysql 等）、URL 全部可在源文件中找到对应，无捏造。
3. **成熟度判断未夸大**：仓颉标"早期→成熟中"（非生产级），MindSpore 标"成熟中"（非生产级），Easysearch 标"成熟中"，SequoiaDB 标"成熟中"——均与源文件一致，无拔高。
4. **客观区分宣传与事实**：报告 §6 专列 10 条"夸大宣传警示"，对仓颉"全场景/高性能"、达梦"Oracle 兼容性业内最佳"、方舟"替代 GCC/LLVM"等宣传口径均明确标注，未将宣传当作事实结论。
5. **迁移成本估算合理**：芯片层"低"（CI 增加构建）、OS 层"低"（已有 webkit40 适配）、对象存储"低"（S3 协议改 endpoint）、MySQL"低"（改 DSN）、PG"中"（换驱动）、Oracle"高"（重写模块+方言）、仓颉"不可行"（关键库缺失）——均与源文件分析一致，逻辑自洽。
6. **未能核实事项诚实标注**：报告 §7 汇总 32 项未能核实事项，全部可在源文件中找到对应，未编造任何内容。
7. **关键实现事实准确**：报告 §2.2 列出的 7 条关键实现事实（K8s 手写 REST、容器 CLI 调用、ES 自研 REST、AES-GCM 加密、已有 OS 适配、provider 架构、Git 同步）全部经源文件源码核实确认，是评估的基础前提。

### 4.2 需要修正的具体条目

| 条目 | 问题 | 修正建议 | 优先级 |
|------|------|---------|:------:|
| §1.2 速览表第 16 行 | 可信性"不可信"与 §3.7"可信"措辞不一致 | 统一口径或加注消歧义 | 低 |
| §3 逐层评估 | 缺少"浏览器内核/WebView 层"独立定位 | 补一段说明或加简短小节 | 低 |

### 4.3 建议的修正动作

1. **（可选）** 在 §1.2 速览表表头"可信性"列加注"（国产替代方案）"，或将 §3.7 可信性等级改为"不适用（保持现状，无国产化压力）"，以消除与速览表的表述歧义。
2. **（可选）** 在 §3.5 或 §3.7 后补充一段"浏览器内核/WebView 层"说明，明确国产安全浏览器（Chromium 系+加固）与 Wails 使用的系统 WebKitGTK 不是同一层次，不构成独立替代层。此为完善性补充，不影响实质结论。

### 4.4 结论

**本报告可以定稿。** 2 处低严重度问题均为措辞完善性质，不影响任何技术结论的正确性与可追溯性。报告整体严谨、客观、可溯源，达到了"不凭空捏造、不夸大宣传、不遗漏关键结论、严格区分宣传与事实"的严谨性要求。

---

*评审完。*