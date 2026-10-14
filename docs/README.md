# 文档索引

按任务阅读；当前说明、候选设计和历史证据分开维护。内容整理日期：2026-10-14。首次运行从[项目首页](../README.md)开始，开发约束见 [AGENTS.md](../AGENTS.md)。

## 使用与开发

| 要做的事 | 文档 |
| --- | --- |
| 理解当前规则、计分和未实现变体 | [玩法规则](guides/rules.md) |
| 打牌、设置四座、看历史和模拟、使用声音与皮肤 | [玩家指南](guides/playing.md) |
| 安装、运行、测试、浏览器回归、Tauri 打包 | [开发与验证指南](guides/development.md) |
| 查看近期候选、任务状态与验收 | [TODO 导航](../TODO.md)、[开发路线](planning/development-roadmap.md) |
| 恢复本地开发技能 | [技能清单与安装](skills/README.md) |

## 当前功能与架构

这些文档描述已有行为和限制；接口与字段以链接的源码为准。

| 文档 | 范围 |
| --- | --- |
| [决策引擎架构](architecture/decision-engines.md) | 四类引擎、阶段观察、RPC、配置、预算与回退 |
| [信息隔离与审计记录](architecture/information-isolation.md) | 已实施的观察/传输边界、透视与 AI 输入分工；验证数字为当时记录 |
| [P0 历史存储](features/history-storage.md) | SQLite、协议、事务、自动保存、查询/导出与恢复 |
| [P1 历史复盘](features/history-replay.md) | 时间线、节点观察、独立分支与原路径保留 |
| [P2 引擎配置](features/engine-profiles.md) | 文件 schema、不可变版本、四座选择、HTTP 路由与恢复 |
| [P3 模拟对战](features/simulations.md) | 独立续打、换边批跑、取消续跑、归因与报告复盘 |
| [AI 观战与动作展示](features/ai-spectator-actions.md) | 暂停/单步、动作步骤、决策原因与可见范围 |
| [优化搜索实现](ai/optimized-ai-implementation.md) | Algorithm 内核、Worker、约束采样与有限残局；附历史实验 |

## AI 评测与证据

| 文档 | 用法与证据边界 |
| --- | --- |
| [评测操作手册](ai/evaluation-runbook.md) | 环境、命令、产物、指纹与日志排查 |
| [统一评测方案](ai/evaluation-plan.md) | L0–L3、裁判、统计、归因和默认替换门槛 |
| [套件 1.4.0 覆盖与诊断](ai/evaluation-coverage.md) | 55 例公开开发集，单次离线诊断；不代表泛化牌力 |
| [套件 1.2.0 历史结果](ai/evaluation-results.md) | 固定 run 的修复验证与旧模型证据，不与新版合并排名 |
| [Prompt 2.0 对照记录](ai/llm-prompt-optimization.md) | 套件 1.2.0 的真实 Qwen 单次同配置对照及反向变化 |
| [策略目标与反例](ai/optimal-play-strategy.md) | 规则推导、条件策略及验证思路，无最优牌力声明 |
| [Qwen 1.4.0 合并诊断](../experiments/results/engine-model-eval/qwen-v14-full-suite-merged.md) | 两个 run 的部分记录合并，codeHash/dataHash 不同；不作为同指纹基线或排名 |
| [原始评测产物索引](../experiments/results/engine-model-eval/README.md) | 固定报告、manifest、输入/动作/响应日志；根汇总会被覆盖 |

## 设计与候选方案

设计表达目标与取舍；完成状态统一见[开发路线](planning/development-roadmap.md)，实际行为见上方功能说明。

| 文档 | 状态与范围 |
| --- | --- |
| [产品设计](design/game-product-design.md) | 首批 UI 已接入，教学/练习等仍为候选 |
| [UI 与交互方案](design/game-ui-interaction-design.md) | 交互规范与设计参考；正式接入见[验证记录](ui/implementation-validation.md) |
| [可点击原型](ui/interaction-prototype.html) | 独立设计演示；截图与原型不证明正式功能完成 |
| [历史、复盘与配置设计](design/history-and-profiles.md) | P0–P3 的关系与设计原则，具体契约委托功能说明 |
| [Bridge 算法设计](design/bridge-ai.md) | 桥牌启发式、DDS/PIMC；设计目标不等于实战优势证据 |
| [优化搜索设计](design/optimized-ai.md) | 约束采样、配对搜索与有限残局的原始设计 |
| [工作台设计](design/workbench.md) | 首版与后续比较/模拟目标；后来交付见 P0–P3 |
| [Laya 演进候选](design/laya-engine.md) | 模型输入、历史与扣底建模建议；不作为当前缺陷或已实现承诺 |
| [AI 研究规格](planning/ai-research.md) | M0–M4 / A0–A4 的范围与验收，状态见开发路线 |
| [后续产品与平台方向](planning/future-directions.md) | 体验、在线、分发、训练与规则演进候选 |

## 维护与历史

| 文档 | 用途 |
| --- | --- |
| [文档治理规则与本次问题记录](maintenance/document-governance.md) | 文档分工、事实来源、更新与归档规则 |
| [Git 文件管理](maintenance/git-tracking-policy.md) | 源码、工具、配置与生成证据的跟踪范围 |
| [开发质量技能应用记录](skills/development-quality.md) | 调试、TDD、验证与浏览器回归的接入 |
| [产品技能应用记录](skills/product-manager-toolkit.md) | 产品设计方法、来源与应用范围 |
| [AI 评测技能源码](skills/yaozifen-ai-evaluation/SKILL.md) | 可安装的项目评测工作流 |
| [历史归档索引](archive/README.md) | 旧路线、待办、LLM 方案、工作台验证和延迟实验 |

历史文档的“当前”、默认值、缺陷、待办和测试数字只代表当时版本。移动文档须同时更新所有引用；维护检查见[治理规则](maintenance/document-governance.md#维护检查)。

为兼容源码注释、本机已安装技能和既有链接，保留[旧评测方案](ai-engine-model-evaluation-plan.md)、[旧存储协议](p0-history-protocol.md)、[旧路线](development-roadmap.md)、[旧评测结果](ai-engine-model-evaluation-results.md)、[旧模拟说明](p3-simulations.md)五个入口。这些页只跳转，当前内容仅在分类目录维护。
