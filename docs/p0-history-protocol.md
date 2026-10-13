# P0 SQLite 历史、自动存档与恢复

> 更新日期：2026-10-13 · P0.1–P0.3 已实现；P1 原路径复盘与反事实分支已完成，见 [P1 实现说明](p1-history-replay.md)；多配置路由与独立模拟按 P2–P3 推进。
>
> 任务顺序与验收门槛见 [开发路线](development-roadmap.md)，产品关系见 [专项设计](game-history-replay-and-engine-profiles.md)。

## 运行环境与文件位置

- 使用内置 `node:sqlite` 的 `DatabaseSync`、`StatementSync` 与 `backup`，没有新增依赖。
- `package.json` 要求 Node **>=22.16.0**，CI 使用 Node 24；该下限包含在线备份 API，见 [Node 22 官方 SQLite 文档](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html#sqlitebackupsourceDb-destination-options)。模块可能输出实验性警告；运行不依赖实验开关。
- `pnpm dev`、`pnpm server`、`pnpm proxy` 启动前实际打开临时库、执行在线备份并校验备份内容；模块缺失或能力不足时明确失败。
- `GAME_DB_PATH` 默认为 `data/history.db`，相对路径按 Node 进程工作目录解析。测试使用 `:memory:` 或临时目录；`data/` 及 SQLite 日志已加入 Git 忽略。
- `GAME_HISTORY=off/0/false/no/disabled` 使 Node 门面返回 `null` 并释放缓存连接。启动前的运行环境检查仍然执行。
- Tauri 无 Node 服务的纯离线持久化尚未实现，后续适配相同 `HistoryRepository`。

## 代码边界

| 位置 | 职责 |
| --- | --- |
| `src/history/contracts.ts` | 版本、记录、输入与 Repository 契约 |
| `src/history/json.ts`、`commands.ts` | 规范化 JSON、SHA-256、命令白名单与节点身份 |
| `src/history/snapshot.ts`、`snapshotValidation.ts` | 完整快照解析、牌张归属与规则重放校验 |
| `src/history/index.ts`、`protocol.ts` | 浏览器安全的共享导出；没有 Node、UI 或 AI 运行器依赖 |
| `server/history/index.ts` | 打开、复用及释放进程内连接 |
| `server/history/sqliteDriver.ts`、`database.ts` | 惰性加载驱动、连接选项、兼容性探测与事务迁移 |
| `server/history/migrations.ts` | 只追加的 SQL 迁移 |
| `server/history/sqliteRepository.ts` | SQL 读写与提交事务编排 |
| `server/history/rowMappers.ts`、`snapshotCodec.ts`、`validation.ts` | 行适配、快照编码、领域与脱敏校验 |

`src/engine/` 不访问 SQL。普通 AI 输入仍使用现有阶段观察投影，数据库完整状态不得直接进入决策请求。服务端目录也纳入 `pnpm build` 的类型检查。

## 数据与版本

当前有八张业务表，另有 `schema_migrations`。模拟表随 P3 增加。

| 表 | 主键与主要关系 |
| --- | --- |
| `matches` | `match_id`；起止时间、来源、状态、目标胜副与规则/应用/实现版本 |
| `hands` | `hand_id`；引用比赛，`(match_id, hand_index)` 唯一，保存起点与真实副结算 |
| `branches` | `branch_id`；引用副、来源节点与末节点；每副只有一条 `actual`，其余是实验分支 |
| `action_nodes` | `node_id`；引用分支与父节点；`(branch_id, seq)` 唯一，保存命令、完整状态、摘要与 checkpoint 标记 |
| `evaluations` | `evaluation_id`；引用节点与配置；`(node_id, request_id)` 唯一，保存观察、候选、推荐及状态/诊断 |
| `initial_evaluations` | 引用分支起点与配置；首个动作前的建议即时保存，不伪造动作节点；采用时引用实际执行节点 |
| `profile_versions` | `profile_version_id`；`(profile_id, config_hash)` 与 `(profile_id, version)` 都唯一，配置内容不可覆盖 |
| `seat_assignments` | `assignment_id`；引用副、分支、节点及配置；Human 无配置引用，AI 必须引用已保存版本 |

外键启用并默认限制删除；没有自动级联删除或清空历史的入口。分支来源必须属于同副，末节点和座位绑定节点必须属于对应分支。

版本独立管理：

- **schema 4**：v1 创建核心表；v2 增加图外键、序号及归属约束；v3 增加真实路径/配置版本唯一约束、复合请求键、观察位置与诊断 JSON 信封。v4 新增起点评估与 `applied_node_id`，将未采用建议与实际执行关联分开。既有 v1–v3 SQL 保持不变。
- **历史 JSON 协议 2**：起点与动作快照保留 `seed`、完整文本 `history` 和所有可执行状态；观察/候选/推荐/配置参数同样使用版本信封。v1 快照可能缺失恢复随机源，明确拒绝读取，不能凭当前规则补造。
- **规则 `basic-v1` / 版本 1**：固定牌张、叫分及结算规则，允许自定义正整数 `targetWins`，且副起点必须与整场一致。自定义 scoring、未知规则或版本明确拒绝。

迁移前用只读连接探测版本；未来版本不会被可写连接或 DDL 改动。待应用迁移共用一个事务，升级冲突或外键断链时回滚并保留旧记录。只读打开要求已存在且为最新 schema。

## 身份、提交与信息隔离

创建记录的缺省 ID 使用类型前缀与 **128 位加密随机熵**，调用方须保留 ID 用于创建重试。动作缺省 ID 使用完整 SHA-256，从分支、父节点、序号、命令、来源、checkpoint 标记及状态摘要派生，忽略重试时间戳。不能直接复用 `game-1` 等进程内序号作持久主键。

`stateDigest` 只覆盖完整局面（包含 seed/history），用于内容校验；节点身份还覆盖提交位置与动作元数据。`canonicalJson` 排序对象键，剔除对象中的 undefined，拒绝非有限数字、函数、非普通对象和循环引用，避免静默丢失内容。

`recordCommit` 在一次事务中保存动作、游标和可选的真实副摘要、评估、座位绑定：

- 新动作必须接当前末端，序号连续；支线首动作接其来源节点。规则执行必须确实产生提交状态。
- 相同节点重试核对动作与附属记录，返回 `duplicated: true`；冲突内容明确拒绝，旧节点重试不会倒退游标。
- 副摘要只能来自真实路径的结束状态，庄家、合同、结果和未打出分全部核对，分支结算不能覆盖真实副摘要。
- `updateMatchStatus` 显式更新整场状态；不存在的更新对象不能假装成功。评估从 `evaluated` 进入 `applied` 或 `stale` 后不能回退。

评估的 `observationPoint` 默认为 `after`（节点局面），将动作前评估附到提交节点时明确填 `before`。观察必须逐字段等于对应局面、座位的 `observeDecision` 投影，不能用改名字段夹带暗牌、拿对手牌冒充 ownHand 或提前公开搭档牌。100 分扣底后的搭档剩余明牌也必须与局面同步。

观察与配置边界递归拒绝凭据、认证内容与完整服务端点，包括回退和错误文本。配置保存脱敏参数及端点标识/环境变量引用；具体引擎配置 schema 与 configHash 构造在 P2.1 完成。候选、推荐和诊断仍由调用方构造，不能把完整隐藏世界当成候选记录。

## 备份与后续接入

- `backupAsync(destination)` 使用 `node:sqlite.backup` 在线一致性备份；`backup(destination)` 使用 `VACUUM INTO` 同步导出。两者均拒绝已有目标文件。
- `integrityCheck()` 检查外键、孤儿父引用与完整局面摘要；它不是历史文件的签名认证。
- 当前每个动作都保存完整状态；`checkpointId` 是标记，没有单独 checkpoint 表。采样频率与压缩后续再确定。
- P0.2 已接入独立提交订阅、HTTP 事务包、浏览器待保存队列与明确失败状态；跨副 `nextHand` 和新副起点在同一事务创建，重开保留中断记录，整场完成不被后续重开改成中断。
- P0.3 已提供列表、分页筛选、详情与校验导出、暂停恢复；P1 已接时间线与分支 UI；P2.1 接多配置文件；P3 接模拟记录。当前没有历史文件导入或 Tauri 原生 SQLite。Tauri 以本地引擎启动时显示“离线模式暂不支持历史”，保留原有离线游戏控制；Node 模式的真实写入失败仍暂停自动推进。

## HTTP、采集与玩家入口

`server/apiHandler.ts` 同时服务 Vite 与独立 Node 代理；数据库惰性打开，写失败返回非成功状态，没有回退到假存档或清库。

| 接口 | 行为 |
| --- | --- |
| `POST /api/history/write` | 协议 2 包；Repository 的一次事务保存起点、配置、动作、结算、跨副起点、评估或状态；失败全回滚 |
| `GET /api/history/matches` | `limit` / `offset` 分页（默认 20，最大 500）；`status` / `source` / `from` / `to` / `engineType` / `bid` 筛选 |
| `GET /api/history/matches/:id/hands` | 副列表、真实结算或最新合同、四座配置名称，不返回私有起点 |
| `GET /api/history/hands/:id` | `game-history` 导出信封；完整起点、分支、节点、评估、配置、座位绑定与 SHA-256 摘要 |

`HistoryRecorder` 订阅 `GameSession` 的合法提交，与 UI 回调相互独立；顺序保存队列不受 200 条决策日志或 1000 个内存节点限制。浏览器使用 `baoshan_history_pending_v2` 保存未确认包，同一身份重试；损坏日志保留原文并阻止自动覆盖，可用“导出待保存记录”取回。事务确认前显示保存中，错误显示未保存并暂停自动推进，重试成功不会自动重新开跑。页面刷新/服务退出的未结束局保持 `in_progress`，主动重开标记旧场 `abandoned`。

首个动作前评估使用 `root:<branchId>` 观察位置，单独存储；节点后评估关联该节点。取消和过期变为 `stale`，采用变为 `applied` 并引用真实执行后的 `appliedNodeId`。数据库观察重新核对合法投影；诊断摘要按白名单采集，不保存原始请求、隐藏世界、完整服务端点或凭据。100 分成功扣底后的规则明牌持续进入观察。

默认 LLM/System One 配置保存客户端实际参数；服务端执行时从现有注册表解析生效模型、预算、重试/并发等参数，记录端点 hash 与环境引用。Bridge 回退另存默认版本，评估记录实际引擎配置；座位绑定保留请求配置。配置文件多实例与历史版本路由仍属于 P2，不声称可以重新连接旧端点。

“对局历史”在普通牌桌与工作台都可打开。导出读取先检查版本、规则、信封摘要、所有节点父链和逐动作规则重放，再允许恢复进行中副牌的实际路径末节点；旧局不只保存 seed/赢家。恢复前须完成当前待保存队列，恢复后暂停并沿用原持久身份；之后的决策使用当前默认配置并另记版本。撤销接管在数据库创建独立路径，保留旧后续；完整分支切换、反事实比较和时间线播放 UI 已按 P1 完成，分支续打使用独立会话。

## 验证

`tests/history-*.test.ts` 覆盖合法全生命周期恢复、分数守恒、100 分明牌、身份冲突/重试、动作与游标原子回滚、错误注入、跨关闭重开、已填充旧库升级/升级回滚、未来版本文件保护、只读与同步/在线备份，以及浏览器完整构建依赖图隔离。

```bash
pnpm test
pnpm build
node scripts/check-node-sqlite.mjs
```

新增行为先写最小回归并确认目标失败：历史 HTTP 未处理、合法提交未入库、丢失确认未暂停、首手建议未保存、严格模式重复建局、服务端参数误记、采用评估缺少执行关联、损坏待保存日志被覆盖、完整路径摘要算法不一致、诊断可见性字段被错误拒绝。随后实现并确认相关测试通过。

`history-autosave/http/recovery/diagnostics/ui` 回归补充：1,010 个动作和跨副完整结算、205 个评估超越实时缓存、SQLite 关闭重开后继续提交、响应丢失幂等重试、浏览器待保存日志保护、100 分明牌与凭据隔离、未知版本和损坏路径拒绝、完整 App 历史交互及 StrictMode 重挂。真实 `pnpm dev` 使用临时库验证自动保存、历史查询与服务重启后恢复；不调用外部模型作为存档验收条件。
