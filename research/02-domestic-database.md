# 国产数据库调研报告（02-domestic-database）

> 调研目标：评估用国产数据库替换 ai-ops-terminal（原 uniTerm）数据库模块中 MySQL / PostgreSQL / Oracle / SQL Server / Redis / MongoDB / Elasticsearch 连接的可行性与可信性。
> 调研方法：优先抓取各厂商官网 / 官方文档，所有关键结论附来源 URL；官网无法抓取的明确标注「未能核实」。
> 调研日期：2026-10-12。网络环境受限：GitHub、Google、百度百科等国外/受限站点不可访问；可访问国内厂商官网与 `cn.bing.com` 搜索镜像。

---

## 0. 结论速览（TL;DR）

| 判定 | 产品 |
| --- | --- |
| **可信（协议完全兼容，仅需改驱动/连接串）** | TiDB、OceanBase（MySQL 模式）、TDSQL、PolarDB（MySQL/PG 版）、阿里云 Tair、腾讯云分布式缓存（Tair/Redis）、Easysearch、腾讯云 ES、SequoiaDB |
| **有条件可信（协议兼容但需注意驱动/认证差异）** | openGauss（PG 协议，但需官方 fork 驱动）、KingbaseES（PG 协议，官方声明未直接核实）、GBase 8c（PG 语法，协议细节待现场验证）、GBase 8s/8c 的 MySQL 模式（语法兼容度 90%~100%，非 100%） |
| **需重写模块（协议不兼容）** | 达梦 DM（自有协议，主攻 Oracle 替代）、OceanBase Oracle 模式（非标准 SQL\*Net） |
| **未能核实（官网前端渲染/反爬，本次无法取证）** | 华为 GaussDB（商用）、华为 GeminiDB for Mongo、华为云 CloudSearch |

**对本项目的核心判断**：
- 项目的 **MySQL 模块替换成本最低**——只需把 DSN 指向 TiDB / OceanBase(MySQL 模式) / TDSQL / PolarDB，Go 驱动 `go-sql-driver/mysql` 无需更换；
- 项目的 **PG 模块可用 openGauss / KingbaseES / GBase 8c / PolarDB(PG)** 替换，openGauss 需换成官方 Go 驱动 fork；
- 项目的 **Redis / MongoDB / ES 模块**（云上）可平滑替换；
- 项目的 **Oracle 模块替换成本最高**——达梦、OceanBase Oracle 模式均不兼容 Oracle 的 SQL\*Net 协议，必须替换驱动并做 SQL 方言适配，"改驱动 + 重写 SQL 方言"量级。

---

## 1. 项目数据库模块现状（本地代码取证）

数据库相关代码位于 `uniterm/backend/database/`（SQL 类）与 `uniterm/backend/session/`（Redis/MongoDB/ES 会话）。

### 1.1 使用的协议与 Go 驱动

| 项目现有数据库 | Go 驱动（go.mod） | 协议 |
| --- | --- | --- |
| MySQL | `github.com/go-sql-driver/mysql v1.10.0` | MySQL wire protocol |
| PostgreSQL | `github.com/lib/pq v1.12.3` | PostgreSQL wire protocol |
| Oracle | `github.com/sijms/go-ora/v2 v2.9.0` | Oracle TNS（纯 Go 实现） |
| SQL Server | `github.com/microsoft/go-mssqldb v1.10.0` | TDS protocol |
| rqlite（SQLite over HTTP） | `github.com/rqlite/gorqlite` | HTTP + SQLite |
| Redis | `github.com/redis/go-redis/v9 v9.21.0` | RESP |
| MongoDB | `go.mongodb.org/mongo-driver v1.17.9` | MongoDB wire protocol |
| Elasticsearch | 无官方 SDK，**自研 `net/http` REST 客户端**（`backend/session/elasticsearch_session.go`） | ES REST API（`_cat/indices`、`_cluster/health` 等） |

> 来源：本地文件 `uniterm/go.mod`；`uniterm/backend/session/elasticsearch_session.go`（import 中仅 `net/http`、`encoding/json`，无第三方 ES 客户端）。

### 1.2 代码规模

- `backend/database/` 目录共 **约 4812 行**（含测试），其中核心实现：`provider_mysql.go` 737、`provider_oracle.go` 678、`provider_postgres.go` 754、`provider_sqlserver.go` 715、`provider_rqlite.go` 533、`executor.go` 228、`engine.go` 216、`scriptsplit.go` 190、`provider.go` 133、`schema.go` 85、`safeident.go` 92。
- NoSQL/搜索会话实现：`backend/session/redis_session.go` 569、`mongodb_session.go` 530、`elasticsearch_session.go` 761，合计 1860 行。
- 每种数据库通过 `provider_*.go` 实现统一的 `Provider` 接口（`provider.go` 定义），**新增/替换数据库本质上是新增一个 provider 实现**——这决定了"协议兼容则低成本、不兼容则需新写 provider"的结论。

> 来源：本地文件 `uniterm/backend/database/`、`uniterm/backend/session/`。

---

## 2. 逐产品调研

### 2.1 openGauss（华为开源，基于 PostgreSQL）

**事实陈述**
- openGauss 官网首页显示当前主推 **openGauss 7.0.0-LTS**，并列出 **openGauss 6.0.6** 版本。
  > 来源：[openGauss 社区官网](https://www.opengauss.org/zh/)
- 版本策略：分为**长期支持版本（LTS）**与**社区创新版本（RCx）**；LTS 发布间隔 2 年，社区提供 3 年维护支持，OGSP 伙伴提供 3 年以上延长维护。
  > 来源：[openGauss 软件包下载页](https://www.opengauss.org/zh/download/)
- 定位：企业级开源关系型数据库，采用木兰宽松许可证 v2 发布。
  > 来源：[openGauss 社区官网](https://www.opengauss.org/zh/)（另见 Bing 镜像摘要，出处 opengauss.org）
- **协议兼容（关键）**：openGauss 提供官方 Go 驱动 `openGauss-connector-go-pq`，其说明为"**基于 libpq 修改**，适配 openGauss SHA256/SM3 密码认证"，支持 SSL、多 host、`pq.ParseURL`、libpq 环境变量、Unix socket、`LISTEN`/`NOTIFY`、pgpass、GSS/Kerberos 等。
  > 来源：[openGauss-connector-go-pq（Gitee）](https://gitee.com/opengauss/openGauss-connector-go-pq)
- 由此可推断：openGauss 使用 PostgreSQL wire protocol，但**默认密码认证算法（SHA256/SM3）与上游 PostgreSQL 不同**，标准 `lib/pq` 无法直接连接，需替换为官方 fork 驱动。
  > 来源：[openGauss-connector-go-pq（Gitee）](https://gitee.com/opengauss/openGauss-connector-go-pq)

**未能核实**
- openGauss 所基于的 PostgreSQL 内核具体版本号（社区常述为 9.2.4 内核，但本次 `docs.opengauss.org` 返回 HTTP 403，未能从官方页面直接取证）。
- openGauss 7.0.0 对 PG wire protocol 的**兼容边界**（哪些系统表、扩展、协议消息与上游 PG 不一致）未能核实。

**替换可行性**：项目 PG 模块 → **需改驱动**（`lib/pq` → `openGauss-connector-go-pq`），并适配认证方式；SQL 方言大体沿用 PG，但需回归测试。
**成熟度**：生产级（政企/运营商规模部署）。
**可信性**：**有条件可信**——协议同一体系但存在驱动与认证差异，不能"零改动"替换。

---

### 2.2 GaussDB（华为商用）

**事实陈述**
- 据第三方资料（百度百科，经 Bing 镜像摘要）："GaussDB 是华为云推出的企业级分布式数据库产品系列，主要包括 GaussDB(for openGauss)、GaussDB(for MySQL) 等"。
  > 来源：百度百科条目（第三方），经 [cn.bing.com 搜索结果](https://cn.bing.com/search?q=GaussDB%20PostgreSQL%20%E5%85%BC%E5%AE%B9%20%E7%89%88%E6%9C%AC) 摘录
- 华为云产品页 `https://www.huaweicloud.com/product/gaussdb.html` 与华为云帮助文档 `https://support.huaweicloud.com/gaussdb/index.html` 返回**前端渲染/反爬脚本**（抓取到的是混淆 JS，页面正文未渲染），本次**无法直接取证**。

**未能核实（明确标注）**
- GaussDB（商用）当前版本号；
- 是否对外提供标准 **MySQL / PostgreSQL wire protocol**，及其兼容边界；
- Go 驱动支持情况（华为云 GaussDB 官方文档未取得）；
- 信创名录/认证情况。

**替换可行性**：**无法判定**（缺官方协议证据）。按业界公开信息，GaussDB 分「for openGauss」与「for MySQL」两条线，若属实则分别对标 openGauss 与 MySQL 的替换路径，但本次未获官方页面佐证。
**成熟度**：生产级（华为云核心商用数据库）。
**可信性**：**暂无法评估**（信息不足；不应仅凭品牌背书下结论）。

---

### 2.3 TiDB（PingCAP）

**事实陈述**
- TiDB 定位：支持 HTAP 的融合型分布式数据库，"**兼容 MySQL 协议和 MySQL 生态**"。
  > 来源：[TiDB 简介（官方文档）](https://docs.pingcap.com/zh/tidb/stable/overview)
- 版本：官方文档当前主版本为 **TiDB Self-Managed v8.5**（Release Notes 列 v8.5.0）。
  > 来源：[TiDB 8.5.0 Release Notes](https://docs.pingcap.com/zh/tidb/stable/release-8.5.0)
- **兼容性（关键）**："TiDB **高度兼容 MySQL 协议**，以及 **MySQL 5.7 和 MySQL 8.0 常用的功能及语法**；MySQL 生态中的系统工具（PHPMyAdmin、Navicat、MySQL Workbench、DBeaver……）可直接使用。"
  > 来源：[与 MySQL 兼容性对比（官方文档）](https://docs.pingcap.com/zh/tidb/stable/mysql-compatibility)
- 已知限制：**不支持 MySQL 复制协议**（官方提供 TiDB Data Migration 工具替代）；**不支持 Oracle/PostgreSQL 兼容模式**（解析但忽略）；部分功能（如存储过程、函数、自增列约定）在 v7.0 前后有差异。
  > 来源：[与 MySQL 兼容性对比（官方文档）](https://docs.pingcap.com/zh/tidb/stable/mysql-compatibility)

**替换可行性**：项目 MySQL 模块 → **仅需改连接串（DSN）**，Go 驱动 `go-sql-driver/mysql` 不变；需回归验证存储过程/触发器等高级语法。
**成熟度**：生产级（Atlassian 等大规模案例，见官网页脚）。
**可信性**：**可信**（协议层官方明确、驱动为标准 MySQL 驱动）。

---

### 2.4 OceanBase（蚂蚁 / 阿里）

**事实陈述**
- 定位："**100% 根自研**，无开源依赖"；"高度兼容 Oracle 与 MySQL，实现平滑迁移"。
  > 来源：[OceanBase 官网](https://www.oceanbase.com/)
- 社区版："**兼容 MySQL 的单机分布式一体化国产开源数据库**"；"从数据类型、SQL 语法，到函数/表达式、优化器，**全面兼容 MySQL 协议，无需修改应用程序代码即可迁至 OceanBase**。**支持 MySQL Binlog 协议**，无缝对接 MySQL 下游数据生态。"
  > 来源：[OceanBase 社区版产品页](https://www.oceanbase.com/product/opensource)
- 版本：官方产品页（Bing 镜像摘要）显示 **OceanBase V4.4.1**。
  > 来源：[OceanBase 社区版产品页](https://www.oceanbase.com/product/opensource)（经 [cn.bing.com 摘要](https://cn.bing.com/search?q=OceanBase%204.x%20%E7%89%88%E6%9C%AC%20Oracle%20%E5%85%BC%E5%AE%B9%E6%A8%A1%E5%BC%8F)）
- OceanBase 提供 **MySQL 模式**与 **Oracle 模式**两种租户兼容模式（官网及文档反复出现"高度兼容 Oracle、MySQL"）。
  > 来源：[OceanBase 官网](https://www.oceanbase.com/)

**未能核实**
- Oracle 模式下的 **Go 驱动**（官方 OceanBase Connector 生态的 Go 支持）具体包与可用性（相关 GitHub 站点不可访问，官方文档未取得对应页）。
- Oracle 模式是否兼容 Oracle 的 SQL\*Net wire protocol（按公开信息应**不兼容**，需专用驱动，本次未取得官方明确声明）。

**替换可行性**
- 项目 **MySQL 模块 → 仅需改连接串**（官方声明"无需修改应用程序代码"）；
- 项目 **Oracle 模块 → 需替换驱动**（OceanBase 专用连接器），协议非标准 SQL\*Net。
**成熟度**：生产级（金融核心系统，官网列北京银行、vivo、滴滴等案例）。
**可信性**：**可信（MySQL 模式）/ 有条件可信（Oracle 模式）**。

---

### 2.5 达梦 DM（DAMENG）

**事实陈述**
- 定位："**100% 自主研发**的大型通用关系型数据库"，支持单机/主备、共享集群（DMDSC）、分布式（DMDPC）等形态，覆盖 OLAP/OLTP/HTAP。
  > 来源：[达梦数据官网](https://www.dameng.com/)
- Oracle 迁移：官网提供"**Oracle 无损移植方案**"；客户案例宣传语称"达梦数据库解决方案层最具备完全同等替换 Oracle 数据库的能力，而且与 Oracle 兼容性业内最佳"（**属厂商/客户宣传语，需谨慎对待**）。
  > 来源：[达梦数据官网](https://www.dameng.com/)
- 版本：达梦官方 **DM8**；Go 驱动仓库说明"安装达梦数据库（**版本 >= 8.1.1.126**）"，标签示例"v1.8.23 来自达梦 **8.1.4.200**"。
  > 来源：[达梦官方 Go 驱动（Gitee）](https://gitee.com/chunanyong/dm)
- **Go 驱动（关键）**：`gitee.com/chunanyong/dm` 自述为"**达梦数据库官方 Go 驱动**，本项目和官方驱动版本同步，方便 go mod 使用"。
  > 来源：[达梦官方 Go 驱动（Gitee）](https://gitee.com/chunanyong/dm)
- 达梦官方文档"DM 应用程序开发"包含 **GO（GO_DM、GO_ODBC）**；同时提供从 Oracle / MySQL / PostgreSQL / SQL Server / DB2 到 DM 的**数据移植指南**。
  > 来源：[达梦技术文档（快速上手）](https://eco.dameng.com/document/dm/zh-cn/start/)
- 协议判断：达梦使用**自有通信协议**（非 MySQL / PostgreSQL wire protocol），应用侧须使用达梦专用驱动（GO_DM/GO_ODBC）。
  > 来源：[达梦技术文档（快速上手）](https://eco.dameng.com/document/dm/zh-cn/start/)（依据其"应用程序开发→GO_DM/GO_ODBC"路径推断）

**替换可行性**：不兼容现有 wire protocol → 项目需**新增达梦 provider + 替换驱动 + SQL 方言适配**（对现有 Oracle 模块影响最大，属"需重写模块"量级）。
**成熟度**：生产级（信创数据库主力厂商之一）。
**可信性**：**有条件可信**（对"Oracle 兼容"的宣传需以实际 SQL 兼容测试为准，不可全信宣传语）。

---

### 2.6 人大金仓 KingBase（KingbaseES）

**事实陈述**
- 品牌：电科金仓（中电科）。官方站点提供 Oracle / MySQL / SQL Server / DB2 / Sybase / Informix / **MongoDB** / InfluxDB 的"平滑迁移方案"。
  > 来源：[人大金仓官网](https://www.kingbase.com.cn/)
- 版本：据第三方（Bing 镜像摘要，出处 kingbase.com.cn/product）："金仓数据库管理系统 **KingbaseES（简称 KES）V9 2025**"。
  > 来源：[cn.bing.com 搜索结果](https://cn.bing.com/search?q=KingbaseES%20%E5%9F%BA%E4%BA%8E%20PostgreSQL%20%E5%86%85%E6%A0%B8)（第三方摘要，官方 product 页 404）
- 提供"**兼容认证**""适配查询"体系（生态适配认证）。
  > 来源：[人大金仓官网](https://www.kingbase.com.cn/)

**未能核实（明确标注）**
- KingbaseES **基于 PostgreSQL 内核**这一业界共识，本次**未能从金仓官方页面直接取证**（官网 product/文档路径返回 404 或前后端分离）；`help.kingbase.com.cn` 无法连接（curl 返回 000）。
- KingbaseES 官方 **Go 驱动**页面与 PG wire protocol 兼容边界。
- 具体最新版本号的官方发布页。

**替换可行性**（基于"PG 内核"共识，需实测确认）：项目 PG 模块 → 预计**改驱动/连接串**即可（KingbaseES 通常兼容 PostgreSQL 协议，可用 `lib/pq` 或金仓提供的驱动）。
**成熟度**：生产级（信创数据库主力之一）。
**可信性**：**有条件可信**（技术路线合理，但关键协议证据本次未取得，建议现场 PoC 验证）。

---

### 2.7 南大通用 GBase

**事实陈述**（来源均为官网产品页）
- **GBase 8c**："多模多态的第三代智能分布式数据库"，支持行存/列存/内存、单机/主备/分布式，支持"**ORACLE、PG、MYSQL 多种兼容模式**"；"**完全兼容 PostgreSQL 语法，兼容常见的 Oracle 语法**"。
  > 来源：[GBase 8c 产品页](https://www.gbase.cn/product/gbase-8c)
- **GBase 8s**：基于共享存储的数据库集群，企业级交易型数据库；提供"**GBase、Oracle、MySQL 三大语法兼容模式**"，其中"**Oracle 模式语法兼容度达 95%**，兼容所有 Oracle 常用数据库对象，完美支持 PL/SQL；**MySQL 模式语法兼容度达 90%**，兼容绝大部分 MySQL 数据类型和内置函数"；达等保四级。
  > 来源：[GBase 8s 产品页](https://www.gbase.cn/product/gbase-8s)
- **GBase 8a**：云原生分析型（OLAP/MPP）数据库，面向数仓/BI 市场。
  > 来源：[GBase 8a 产品页](https://www.gbase.cn/product/gbase-8a)

**未能核实**
- GBase 8c 是否**基于 openGauss 内核**（Bing 摘要存在此暗示，但官网自述为"自主研发"，未提 openGauss，故不作为事实结论）。
- GBase 各产品对外暴露的 **wire protocol** 类型（官网只强调"语法兼容模式"，**语法兼容 ≠ 协议兼容**）。

**替换可行性**：GBase 8c 与 PG 亲和（"完全兼容 PostgreSQL 语法"），项目 PG 模块**预计改驱动/连接串**，需实测协议；GBase 8s 的 MySQL/Oracle 模式为**语法兼容**（90%/95%），非 100% 协议兼容，**需改连接逻辑 + 语法回归**。
**成熟度**：成熟中~生产级（8a/8s 在电信、政府等领域有规模部署，官网列案例）。
**可信性**：**有条件可信**（需区分"语法兼容度 90%/95%"与实际协议/驱动可用性）。

---

### 2.8 PolarDB（阿里云）

**事实陈述**
- 定位："秒级弹性、高性价比……**100% 兼容 MySQL、PostgreSQL，高度兼容 Oracle 语法**，支持集中式和分布式"；包含 **PolarDB MySQL 版、PolarDB PostgreSQL 版、PolarDB 分布式版**。
  > 来源：[阿里云 PolarDB 产品页](https://www.aliyun.com/product/polardb)
- "完全兼容 MySQL 和 PostgreSQL，高度兼容 Oracle 语法，支持集中式和分布式，支持千亿级大表和 PB 级存储。"
  > 来源：[阿里云 PolarDB 产品页](https://www.aliyun.com/product/polardb)

**替换可行性**：项目 MySQL 模块 → 改连接串；项目 PG 模块 → 改连接串；Oracle 语法 → 见"高度兼容 Oracle 语法"（**语法层面，非协议**）。
**成熟度**：生产级（阿里云核心云数据库）。
**可信性**：**可信（MySQL/PG 版）**（云托管，标准协议）。

---

### 2.9 TDSQL（腾讯云）

**事实陈述**
- TDSQL MySQL 版（= TencentDB for MariaDB / TDSQL MySQL 版集中式）"采用腾讯云自研的 **MySQL 内核分支 TXSQL**，兼容 MySQL 和 MariaDB"；"**兼容 MySQL 协议**，包括 MySQL 的语言结构、字符集、数据类型、函数、存储过程、事务等；**业务系统无需改造即可直接从 MySQL 迁移**到云数据库"。
  > 来源：[腾讯云 TDSQL 产品页](https://cloud.tencent.com/product/tdsql)
- 在核心系统中可替代 Oracle（官网金融场景描述）。
  > 来源：[腾讯云 TDSQL 产品页](https://cloud.tencent.com/product/tdsql)

**替换可行性**：项目 MySQL 模块 → **仅需改连接串**（官方明确"兼容 MySQL 协议、无需改造"）；Oracle 场景需结合 TDSQL 的 Oracle 兼容能力（本次未取得其 Oracle 协议细节）。
**成熟度**：生产级（金融/电商）。
**可信性**：**可信（MySQL 协议）**。

---

### 2.10 Redis 国产替代

**事实陈述**
- **阿里云 Tair（兼容 Redis）**："**兼容开源 Redis 多版本，无需修改代码即可迁移使用**；Tair 的内置 modules 可提升开发能效"；全托管，亚毫秒时延。
  > 来源：[阿里云 Tair（兼容 Redis）产品页](https://www.aliyun.com/product/redis)
- **腾讯云分布式缓存数据库（云数据库 Tair / Redis）**："腾讯云打造的**兼容 Redis、Valkey 和 Memcached 引擎**的缓存和存储服务"；标准/集群两大架构，最大 8TB。
  > 来源：[腾讯云分布式缓存数据库产品页](https://cloud.tencent.com/product/crs)、[腾讯云分布式缓存文档](https://cloud.tencent.com/document/product/239)
- **openGauss 不提供 Redis 协议**，无法作为 Redis 的替代（openGauss 是关系型数据库）。
  > 来源：[openGauss 社区官网](https://www.opengauss.org/zh/)（无 Redis/KV 协议能力描述）

**未能核实**
- **KeyDB**：该项目托管于 GitHub（本次不可访问），未能核实其国产化属性与版本——需注意 KeyDB 实际为国外（Snap）主导项目，**不属于国产替代**。
- 是否存在"国产开源 Redis 内核"级别的替代品——本次调研中，国产方案主要以**云厂商托管 + 内核增强（Tair 自研）**形态存在。

**替换可行性**：项目 Redis 模块（`go-redis`，RESP）→ **仅需改连接地址/鉴权**（云上需适配 TLS、集群/哨兵模式）。**可信**。
**成熟度**：生产级。

---

### 2.11 MongoDB 国产替代

**事实陈述**
- **巨杉 SequoiaDB**：官网首页定位为"**文档型数据库 SequoiaDB_MongoDB 国产化替换首选**"，产品含 SequoiaDB、SequoiaCM，面向实时数据湖/多模数据湖/数据库国产化/主机下移等场景。
  > 来源：[巨杉数据库官网](http://www.sequoiadb.com/)
- **华为云 GeminiDB for Mongo（GeminiDB Mongo）**：华为云产品页/帮助文档返回前端渲染/反爬脚本，本次**未能取证**。
- 人大金仓官网亦列出"MongoDB 平滑迁移方案"。
  > 来源：[人大金仓官网](https://www.kingbase.com.cn/)

**未能核实**
- SequoiaDB 是否**兼容 MongoDB wire protocol**（官网仅以"国产化替换首选"作定位，未在同一页面明示协议兼容性；本次未能抓到其技术文档）。
- GeminiDB for Mongo 的版本、协议兼容性、Go 驱动支持。

**替换可行性**：SequoiaDB **预计**可兼容 MongoDB 协议（官网定位 + 行业实践），项目 `mongo-driver` 有望平滑迁移，但**必须现场验证协议命令覆盖率**后再下结论；GeminiDB 暂无法判定。
**成熟度**：成熟中（SequoiaDB）；生产级（GeminiDB，云托管）。
**可信性**：**SequoiaDB 有条件可信 / GeminiDB 暂无法评估**。

---

### 2.12 Elasticsearch 国产替代

**事实陈述**
- **Easysearch（极限科技 INFINI Labs）**："提供一个**自主可控**的轻量级 Elasticsearch 可替代版本"；"**业务代码不需要做任何调整**，开发团队无缝衔接，**兼容现有索引存储数据，向下兼容至 Elasticsearch 6.x 版本索引**"；提供基于备份快照/网关/原地替换/可视化工具的完整迁移方案；产品动态含 Easysearch 2.4.0。
  > 来源：[Easysearch 官网](https://www.easysearch.cn/)
- **腾讯云 Elasticsearch Service**："集文本搜索+向量搜索+AI 能力于一体"，"**兼容 ELK 生态**"，支持 ES 版本升级。
  > 来源：[腾讯云 Elasticsearch Service 产品页](https://cloud.tencent.com/product/es)
- **华为云 CloudSearch**：产品页返回前端渲染/反爬脚本，本次**未能取证**。
- **OpenSearch**：官网可访问（Apache 2.0 许可，OpenSearch Software Foundation 治理），但**属于国外主导的开源项目，不是中国国产化产品**。
  > 来源：[OpenSearch 官网](https://opensearch.org/)

**未能核实**
- Easysearch 是否 100% 兼容 ES 7.x/8.x REST API（官网称向下兼容至 6.x 索引，但未逐一列明 API 覆盖度）。
- CloudSearch 的版本与兼容性。

**替换可行性**：项目 ES 模块为**自研 REST 客户端**，只需把 baseUrl/端口/鉴权指向 Easysearch 或腾讯云 ES，即可迁移（**仅需改连接逻辑**）；需回归验证用到的具体 REST 路径（`_cat/indices`、`_cluster/health`、`cat/nodes` 等）。
**成熟度**：成熟中（Easysearch，官网列中国一汽、中国移动云等案例）；生产级（腾讯云 ES）。
**可信性**：**可信**（REST 协议通用）。

---

## 3. 协议兼容性矩阵

图例：✅ 完全兼容 ｜ 🟡 部分兼容/需注意 ｜ ❌ 不兼容 ｜ ❓ 未能核实

| 国产数据库 | 对 MySQL wire | 对 PG wire | 对 Oracle(SQL\*Net) | 对 Redis RESP | 对 MongoDB wire | 对 ES REST |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| openGauss | ❌ | 🟡（须官方 fork 驱动 / SHA256 认证） | ❌ | ❌ | ❌ | ❌ |
| GaussDB（商用） | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ |
| TiDB | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| OceanBase（MySQL 模式） | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| OceanBase（Oracle 模式） | ❌ | ❌ | 🟡（语法兼容，非 SQL\*Net 协议，需专用驱动） | ❌ | ❌ | ❌ |
| 达梦 DM | ❌ | ❌ | 🟡（语法/工具兼容，自有协议，需 DM 驱动） | ❌ | ❌ | ❌ |
| KingbaseES | ❌ | 🟡（PG 内核共识，协议未直接核实） | ❌ | ❌ | ❌ | ❌ |
| GBase 8c | 🟡（MySQL 兼容模式，语法） | 🟡（"完全兼容 PG 语法"，协议待实测） | 🟡（兼容常见 Oracle 语法） | ❌ | ❌ | ❌ |
| GBase 8s | 🟡（MySQL 模式语法兼容度 90%） | ❌ | 🟡（Oracle 模式语法兼容度 95%，PL/SQL） | ❌ | ❌ | ❌ |
| PolarDB（MySQL 版） | ✅ | — | 🟡（高度兼容 Oracle 语法） | ❌ | ❌ | ❌ |
| PolarDB（PG 版） | — | ✅ | 🟡（高度兼容 Oracle 语法） | ❌ | ❌ | ❌ |
| TDSQL | ✅ | ❌ | 🟡（可替代 Oracle，协议未核实） | ❌ | ❌ | ❌ |
| 阿里云 Tair | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| 腾讯云分布式缓存（Tair） | ❌ | ❌ | ❌ | ✅（兼容 Redis/Valkey/Memcached） | ❌ | ❌ |
| SequoiaDB | ❌ | ❌ | ❌ | ❌ | 🟡（MongoDB 替换首选，协议待实测） | ❌ |
| 华为 GeminiDB for Mongo | ❌ | ❌ | ❌ | ❌ | ❓ | ❌ |
| Easysearch | ❌ | ❌ | ❌ | ❌ | ❌ | ✅（兼容 ES 索引至 6.x） |
| 腾讯云 ES | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 华为云 CloudSearch | ❌ | ❌ | ❌ | ❌ | ❌ | ❓ |

> 说明：表中"🟡"强调**「官方宣传的兼容」与「实际生产可用的兼容」的差异**——GBase/达梦/OceanBase 的 Oracle 兼容，以及 GBase 8s 的 MySQL 兼容，官网给出的是**语法兼容度（90%/95%）**，并非 wire protocol 兼容；项目在替换 Oracle/MySQL 模块时，仍会因存储过程、系统函数、驱动差异产生改造成本。

---

## 4. 成熟度评级

| 产品 | 评级 | 依据 |
| --- | --- | --- |
| TiDB | **生产级** | 官方版本 v8.5，大规模 HTAP 案例 |
| OceanBase | **生产级** | 金融核心系统、v4.4.1，官网列 4000+ 企业 |
| 达梦 DM | **生产级** | 信创主力，DM8 体系 |
| KingbaseES | **生产级** | 信创主力，KES V9 |
| openGauss / GaussDB | **生产级** | 华为体系，政企规模化 |
| PolarDB / TDSQL | **生产级** | 头部公有云托管数据库 |
| GBase（8a/8s/8c） | **成熟中~生产级** | 电信/政府规模部署 |
| 阿里云 Tair / 腾讯云 Tair | **生产级** | 云托管，兼容 Redis |
| SequoiaDB | **成熟中** | 国产分布式文档库，定位明确 |
| Easysearch | **成熟中** | 2.4.0 发布、有央企案例 |
| GeminiDB for Mongo / CloudSearch | **生产级（云托管）但本次未核实** | 华为云产品，证据不足 |

---

## 5. 替换可行性（对项目各模块）

| 项目模块 | 可用国产替代 | 改造量级 | 说明 |
| --- | --- | --- | --- |
| **MySQL**（`go-sql-driver/mysql`） | TiDB / OceanBase(MySQL模式) / TDSQL / PolarDB(MySQL) / GBase 8s | **只需改连接串** | 协议兼容，驱动不变；少量 SQL 语法回归 |
| **PostgreSQL**（`lib/pq`） | openGauss / KingbaseES / GBase 8c / PolarDB(PG) | **需改驱动**（openGauss 必须换官方 fork；其余可试 `lib/pq`） | 认证方式与协议扩展需验证 |
| **Oracle**（`sijms/go-ora`） | 达梦 DM / OceanBase(Oracle模式) | **需重写模块**（换驱动 + SQL 方言适配） | 协议非 SQL\*Net，须新增 provider |
| **SQL Server**（`go-mssqldb`） | 无直接国产对应（部分国产库提供"SQL Server 迁移方案"） | **需重写模块** | 信创场景通常整体替换为国产关系库 |
| **Redis**（`go-redis`） | 阿里云 Tair / 腾讯云分布式缓存(Tair) | **只需改连接串** | RESP 兼容，注意 TLS/集群模式 |
| **MongoDB**（`mongo-driver`） | SequoiaDB / GeminiDB Mongo | **只需改连接串（预计）** | 需实测协议命令覆盖 |
| **Elasticsearch**（自研 REST） | Easysearch / 腾讯云 ES / CloudSearch | **需改连接逻辑（很轻）** | 仅改 baseUrl/鉴权，REST 通用 |

> 关键洞察：项目采用 **provider 插件式架构**（`backend/database/provider.go` 定义接口），因此**协议兼容的替代只需新增/复用 provider + 改驱动**；协议不兼容的（如达梦）则需要完整实现一个新 provider（对标现有 `provider_oracle.go` 的 678 行规模）。

---

## 6. 可信性判断汇总

| 产品 | 判定 | 理由 |
| --- | --- | --- |
| TiDB | **可信** | 官方明确"高度兼容 MySQL 协议"，标准 MySQL 驱动即可 |
| OceanBase（MySQL 模式） | **可信** | 官方"全面兼容 MySQL 协议、无需改代码"，支持 Binlog 协议 |
| TDSQL | **可信** | 官方"兼容 MySQL 协议、业务无需改造" |
| PolarDB（MySQL/PG 版） | **可信** | 官方"100% 兼容 MySQL/PostgreSQL" |
| 阿里/腾讯 Tair | **可信** | 官方"兼容 Redis（多版本/Valkey/Memcached）" |
| 腾讯云 ES | **可信** | 兼容 ELK 生态，REST 通用 |
| Easysearch | **可信** | 兼容 ES 索引/API 至 6.x，迁移方案完整 |
| openGauss | **有条件可信** | PG 协议但需官方 fork 驱动 + SHA256/SM3 认证 |
| KingbaseES | **有条件可信** | PG 内核路线合理，但本次未取得官方协议声明 |
| GBase | **有条件可信** | "语法兼容度 90%/95%"，语法≠协议，需实测 |
| 达梦 DM | **有条件可信** | "Oracle 兼容性业内最佳"为厂商宣传，须以 SQL 实测为准；协议不兼容 |
| SequoiaDB | **有条件可信** | MongoDB 替换定位明确，协议兼容待实测 |
| GaussDB（商用） | **暂无法评估** | 官网反爬，关键证据缺失 |
| GeminiDB / CloudSearch | **暂无法评估** | 官网反爬，关键证据缺失 |

---

## 7. 国产数据库替代选型总览表

| 替代对象 | 首选国产方案 | 备选 | 协议兼容 | 成熟度 | 可信性 | 迁移成本 |
| --- | --- | --- | --- | --- | --- | --- |
| MySQL | **TiDB**（协议最标准） | OceanBase(MySQL)/TDSQL/PolarDB(MySQL)/GBase 8s | ✅ | 生产级 | 可信 | 低（改 DSN） |
| PostgreSQL | **openGauss** | KingbaseES / GBase 8c / PolarDB(PG) | 🟡 | 生产级 | 有条件可信 | 中（换驱动） |
| Oracle | **达梦 DM** | OceanBase(Oracle 模式) | 🟡 | 生产级 | 有条件可信 | 高（重写模块+方言） |
| SQL Server | 无直接对应 | 整体迁移至国产关系库 | ❌ | — | — | 高 |
| Redis | **阿里云 Tair / 腾讯云 Tair** | 自建 Redis（非国产） | ✅ | 生产级 | 可信 | 低 |
| MongoDB | **SequoiaDB** | GeminiDB for Mongo | 🟡 | 成熟中 | 有条件可信 | 低~中（待实测） |
| Elasticsearch | **Easysearch** | 腾讯云 ES / CloudSearch | ✅ | 成熟中 | 可信 | 低（改 baseUrl） |

---

## 8. 信创采购的实际主流 vs 技术宣传

- **实际主流选择**：关系型数据库信创市场以 **达梦 DM、人大金仓 KingBase、openGauss/GaussDB、OceanBase、TiDB** 为主力；云上场景 **PolarDB / TDSQL** 占优。（基于各厂商官网案例与行业定位综合判断，非单一官方来源）
- **技术宣传值得警惕之处**：
  - "兼容 Oracle"≠ 兼容 Oracle 协议：达梦、OceanBase Oracle 模式、GBase 的 Oracle 兼容均为**语法/对象兼容**，须替换驱动，改造成本不可低估（OceanBase 官网"高度兼容 Oracle"、达梦官网"Oracle 兼容性业内最佳"均为**宣传口径**）。
  - "语法兼容度 90%/95%"（GBase 8s 官网明示）意味着**仍有 5%~10% 语法不兼容**，需逐条回归。
  - 华为云 GaussDB/GeminiDB/CloudSearch 官网为**前端渲染，本次无法取证**，不应在缺乏官方协议证据时将其列入"确定可替换"。
- **信创名录/认证**：OceanBase 官网自述"**首批通过安全可靠测评**"。
  > 来源：[OceanBase 官网](https://www.oceanbase.com/)
  其余产品的工信部"安全可靠测评"公告/信创名录**本次未能核实**（相关公告站点未抓取成功），采购时应以**工信部安全可靠测评结果公告**与厂商授权名录为准。

---

## 9. 明确未能核实清单（供后续 PoC 补全）

1. **华为 GaussDB（商用）**：版本号、MySQL/PG wire 协议兼容性、Go 驱动 —— 官网 `huaweicloud.com/product/gaussdb.html`、`support.huaweicloud.com/gaussdb/` 均为前端渲染/反爬，抓取到混淆 JS，无正文。
2. **华为云 GeminiDB for Mongo**：版本、MongoDB 协议兼容性 —— 官网同样反爬。
3. **华为云 CloudSearch**：版本、ES 兼容性 —— 官网同样反爬。
4. **openGauss**：所基于 PostgreSQL 内核的具体版本号 —— `docs.opengauss.org` 返回 HTTP 403。
5. **KingbaseES**：基于 PostgreSQL 内核的**官方直接声明** —— 官网 product/文档路径 404，`help.kingbase.com.cn` 无法连接（curl 000）。
6. **GBase 8c 是否基于 openGauss 内核** —— 官网自述"自主研发"，未提 openGauss。
7. **达梦**：最新版本号的官方发布页 —— `eco.dameng.com` 版本页为前端渲染（提取为空），仅从 Go 驱动仓库获得 DM8/8.1.x 佐证。
8. **OceanBase Oracle 模式的 Go 驱动与 SQL\*Net 兼容性** —— 相关 GitHub 站点不可访问。
9. **SequoiaDB 对 MongoDB wire protocol 的兼容边界** —— 未取得其技术文档正文。
10. **KeyDB** —— GitHub 不可访问；且 KeyDB 为国外主导项目，**不属于国产替代**。
11. **工信部安全可靠测评名录 / 信创目录**中的具体产品认证状态 —— 未抓取到公告页面。

> 说明：本报告中所有"未能核实"均为**本次网络环境下的取证限制**，不代表产品本身不具备该能力；涉及关键决策（尤其是达梦、GaussDB、KingbaseES 的协议兼容）时，必须进行**现场 PoC（用标准 MySQL/PG 驱动直连 + 关键 SQL 回归）**后再定论。

---

## 10. 来源索引

| # | 标题 | URL |
| --- | --- | --- |
| 1 | openGauss 社区官网（7.0.0-LTS / 6.0.6） | https://www.opengauss.org/zh/ |
| 2 | openGauss 软件包下载页（LTS/RC 策略） | https://www.opengauss.org/zh/download/ |
| 3 | openGauss-connector-go-pq（官方 Go 驱动，基于 libpq，SHA256/SM3） | https://gitee.com/opengauss/openGauss-connector-go-pq |
| 4 | TiDB 简介（兼容 MySQL 协议与生态） | https://docs.pingcap.com/zh/tidb/stable/overview |
| 5 | TiDB 与 MySQL 兼容性对比 | https://docs.pingcap.com/zh/tidb/stable/mysql-compatibility |
| 6 | TiDB 8.5.0 Release Notes | https://docs.pingcap.com/zh/tidb/stable/release-8.5.0 |
| 7 | OceanBase 官网（100% 根自研，兼容 Oracle/MySQL） | https://www.oceanbase.com/ |
| 8 | OceanBase 社区版产品页（兼容 MySQL 协议、Binlog，V4.4.1） | https://www.oceanbase.com/product/opensource |
| 9 | 达梦数据官网（Oracle 无损移植方案） | https://www.dameng.com/ |
| 10 | 达梦技术文档快速上手（GO_DM/GO_ODBC、数据移植） | https://eco.dameng.com/document/dm/zh-cn/start/ |
| 11 | 达梦官方 Go 驱动（Gitee，DM8/8.1.x） | https://gitee.com/chunanyong/dm |
| 12 | 人大金仓官网（迁移方案/兼容认证） | https://www.kingbase.com.cn/ |
| 13 | GBase 8c 产品页（PG 语法完全兼容，ORACLE/PG/MYSQL 模式） | https://www.gbase.cn/product/gbase-8c |
| 14 | GBase 8s 产品页（Oracle 语法 95%、MySQL 语法 90%） | https://www.gbase.cn/product/gbase-8s |
| 15 | GBase 8a 产品页（OLAP/MPP） | https://www.gbase.cn/product/gbase-8a |
| 16 | 阿里云 PolarDB 产品页（100% 兼容 MySQL/PG） | https://www.aliyun.com/product/polardb |
| 17 | 腾讯云 TDSQL 产品页（兼容 MySQL 协议） | https://cloud.tencent.com/product/tdsql |
| 18 | 阿里云 Tair（兼容 Redis）产品页 | https://www.aliyun.com/product/redis |
| 19 | 腾讯云分布式缓存数据库产品页（Redis/Valkey/Memcached） | https://cloud.tencent.com/product/crs |
| 20 | 腾讯云分布式缓存文档 | https://cloud.tencent.com/document/product/239 |
| 21 | 巨杉 SequoiaDB 官网（MongoDB 国产化替换首选） | http://www.sequoiadb.com/ |
| 22 | Easysearch 官网（ES 替代，兼容至 6.x） | https://www.easysearch.cn/ |
| 23 | 腾讯云 Elasticsearch Service 产品页 | https://cloud.tencent.com/product/es |
| 24 | OpenSearch 官网（国外开源项目） | https://opensearch.org/ |
| 25 | 华为云 GaussDB 产品页（本次前端渲染未能取证） | https://www.huaweicloud.com/product/gaussdb.html |
| 26 | 华为云 GeminiDB 产品页（本次前端渲染未能取证） | https://www.huaweicloud.com/product/geminidb.html |
| 27 | 华为云 CloudSearch 产品页（本次前端渲染未能取证） | https://www.huaweicloud.com/product/css.html |
| 28 | cn.bing.com 搜索镜像（第三方摘要，用于 GaussDB/OceanBase 版本等佐证） | https://cn.bing.com/search |

---

*报告结束。所有结论均基于上述可访问来源；凡存疑处已显式标注"未能核实"，未作任何版本号或兼容性的臆测。*