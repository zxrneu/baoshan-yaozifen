# P2 · 版本化引擎配置与四座路由

> 文档类型：当前实现说明；内容复核：2026-10-14。P2.1–P2.3 已实现；首次交付使用历史 JSON 协议 2 / SQLite schema 4，P3 后当前 SQL schema 为 5；规则仍为 basic-v1。版本定义见[历史存储](history-storage.md)，返回[文档索引](../README.md)。

P2 没有引入依赖，也没有替换默认策略或宣称牌力提升。

## 使用

```bash
cp .env.example .env
cp engine-profiles.example.json engine-profiles.json
# 在 .env 设置 ENGINE_PROFILES_PATH=engine-profiles.json
# 修改 JSON 中的 model；在 .env 填各组服务地址、可选密钥。
pnpm dev
# 或 pnpm server + pnpm client
```

不指定配置文件时，服务端将旧的 LLM/Laya 环境配置迁移为 `default-llm` / `default-laya`，并提供默认 Bridge/Algorithm；旧 `engineType` RPC 仍兼容。指定文件后，该文件是可选配置目录的来源。模板包含两组 LLM、两组 System One 和多组 Bridge/Algorithm；System One 使用 `laya` 类型及现有 `/v1/systemone` 协议。端点可为服务根地址或完整 System One 路径。

点击牌桌上的各家引擎名称可逐座选择 Human（人工）或任意配置。设置不再提供两队批量配置或统一引擎覆盖入口。多个人工座位轮到谁就操作谁的手牌；全部 AI 时可观战。普通 AI 输入仍来自阶段观察，显示视角不扩散到 AI。南家为默认人工座位。

“设置 → 开发者选项”可重新加载配置文件、按名称编辑 JSON 参数并保存新版本。编辑携带预期版本，目录已改变时拒绝覆盖；文件通过同目录临时文件 + rename 原子替换。重载只更新目录，本副已选择版本继续冻结；显式重新选择立即记配置变化并取消旧请求，下一副采用目录中的同 id 新版本。旧版本不会被回写。没有文件路径时可使用迁移默认配置，参数编辑会提示先配置文件。

本地模式只提供 Bridge/Algorithm，并使用独立实例、相同搜索参数与 `execution=local` 的版本；Algorithm 浏览器使用 Worker，服务端使用同一 PairedSearch 运行器，服务端不再因为缺少浏览器 Worker 而空转。模型服务配置通过 HTTP 在 Node 内解析，凭据不下发。纯离线 Tauri 的 SQLite 适配仍后置。

## 配置契约

`schemaVersion=1`；每条包含 `id`、`name`、`type`、`options` 和可选 `fallbackProfileId`。严格拒绝未知字段、重复 id、无效枚举/预算、缺失环境引用、未知备用和备用环。Bridge 的 fast/deep 分别展开现有默认参数；Algorithm 的完整优化预算传入真实运行器。各类型只接受已实现字段，详情见示例模板与 `src/ai/engines/profiles.ts`。

LLM 可设置 model、protocol、responseFormat、reasoningEffort、timeoutMs、maxRetries、maxConcurrency、disableBidAdvice。System One 可设置 model、timeoutMs。两类模型均使用 `baseUrlEnv`、`apiKeyEnv`；没有密钥时允许匿名调用。Bridge/Algorithm 的前三阶段以及 System One 扣底是启发式，`capabilities` 明确记录；唯一候选是 `deterministic`，不记作模型调用。

参数上限集中校验：超时/决策总预算为 1–3,600,000 ms，兼容旧环境中的显式长超时；默认 LLM 60 s，默认 System One 2.5 s，不将大上限当推荐预算。profile 客户端默认总预算为所选阶段预算加 1.5 s 回退余量，RPC 等待再留 5 s 通信时间。显式 `totalBudgetMs` 优先；服务端预算涵盖排队、全部 SDK 重试及回退，耗尽时返回无动作失败，不再执行备用。LLM 实例自身超时也涵盖并发排队，取消不应用迟到结果并释放槽位。每实例独立并发队列。

版本为规范化配置、名称、类型、执行位置、端点摘要、实现/Prompt 标识和**备用版本引用**的 SHA-256；profileVersionId 使用完整摘要。密钥不参与版本，允许凭据轮换。列表、SQLite 和导出只保存环境变量名、服务摘要及脱敏参数；不保存服务 URL 和凭据。

## HTTP 与历史

- `GET /api/engine-profiles`：当前配置目录，含名称、参数、能力和版本。
- `POST /api/engine-profiles`：`{reload:true}` 重载；或 `{profileId,expectedVersion,name,options}` 编辑；`{resolve:[{profileId,version}]}` 校验历史版本及其备用链。
- `GET /api/engines` / `/api/health`：保留旧类型摘要，同时按 profile 探测服务并返回脱敏可用状态。
- `POST /api/decision`：原阶段观察协议新增 `profileId`、`profileVersion`、`requestId`、`totalBudgetMs`；身份和版本必须同时提供。profile 模式忽略旧的客户端 options 覆盖，使用冻结服务端配置。
- 响应新增 `requestedProfile`、`actualProfile`、`fallbackChain`、`decisionSource`、`requestId`。非法动作/网络故障才走配置的显式备用链；主动取消和总预算耗尽不回退。客户端服务不可用时记录独立本地 Bridge 备用版本。

实际评估按 `actualProfile` 关联 SQLite 版本，不再用 type 猜测同类中的哪一个。请求版本、真实回退链和来源保存在评估建议中，未采用评估仍与动作分开。配置变更按当时节点保存四座 assignment。

恢复 P2 存档先校验冻结版本与备用链，再替换活动局；Node 重启后可从 SQLite 脱敏快照重建旧参数，通过环境引用恢复服务。端点摘要变化、未知实现/Prompt 或指纹不匹配会明确拒绝；校验失败不修改活动对局。P0/P1 旧默认快照保持其原兼容行为，不把缺失的历史参数猜成可恢复版本。

## 验证与范围

采用红 → 绿：首批因配置接口不存在/无 schema 校验失败；路由因仍走类型默认配置、无版本身份失败；界面因无四座选择失败；恢复因旧版本被当前参数重算失败；编辑因旧目录仍可覆盖失败。逐项实现后相关测试通过。测试显式注入模型响应、非法动作、网络失败、挂起客户端和可控时钟，不依赖本机模型在线。

新增回归覆盖同类型独立模型/端点/鉴权、版本/hash、备用链、HTTP 参数实际生效、Algorithm 两世界预算、排队超时与释放槽位、取消/迟到结果、四座选择、两队分配、冻结与下一副重载、参数编辑、SQLite 旧版本恢复和服务地址/密钥隔离。本次 `pnpm test`：54 个文件、660 项全部通过；`pnpm build`：类型检查与生产构建通过（仍有现有的大 chunk 提示）。

P3 的独立四座模拟、批跑报告和复盘联通仍未交付；P1 分支入口仍使用原有默认配置有界模拟，不以它冒充 P3。任意代码插件、模型排名和训练也不在 P2 范围。
