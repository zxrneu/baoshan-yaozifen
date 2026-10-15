# 文档索引

当前实现以源码、配置和测试为准；候选方案不表示已经交付。首次运行见[项目首页](../README.md)，开发约束见 [AGENTS.md](../AGENTS.md)。

## 使用与架构

| 要做的事 | 文档 |
| --- | --- |
| 理解规则、计分与变体边界 | [玩法规则](guides/rules.md) |
| 打牌、练习、教学、观战、历史与模拟 | [玩家指南](guides/playing.md) |
| 安装、开发、构建、浏览器回归与原生打包 | [开发指南](guides/development.md) |
| 理解 workspace、包依赖与运行路径 | [Monorepo 结构](architecture/monorepo.md) |
| 理解决策、RPC、配置与回退 | [决策架构](architecture/decision-engines.md) |
| 核对 AI 可见信息与隔离回归 | [信息隔离](architecture/information-isolation.md) |
| 理解本地会话、快照与异步请求 | [工作台与会话](design/workbench.md) |

## 功能说明

[历史存储](features/history-storage.md) · [复盘与分支](features/history-replay.md) · [引擎配置](features/engine-profiles.md) · [模拟对战](features/simulations.md) · [观战与动作展示](features/ai-spectator-actions.md)

## AI 与评测

| 文档 | 职责 |
| --- | --- |
| [评测操作手册](ai/evaluation-runbook.md) | 命令、参数、输出与排错 |
| [统一评测方案](ai/evaluation-plan.md) | 样本契约、归因、指标与默认替换门槛 |
| [策略目标与反例](ai/optimal-play-strategy.md) | 规则推导与条件策略 |
| [Algorithm 实现](ai/optimized-ai-implementation.md) | 观察、采样、搜索、Worker 与预算 |
| [Bridge 设计](design/bridge-ai.md) · [优化搜索设计](design/optimized-ai.md) | 算法原理和适用边界 |

固定样本位于 `data/evaluation/`，运行产物位于被忽略的 `experiments/results/` 或各实验输出目录。仓库不维护历史成绩榜、原始请求日志或一次性评审记录。

## 产品与候选方案

| 文档 | 职责 |
| --- | --- |
| [产品设计](design/game-product-design.md) | 玩家任务、体验目标与候选切片 |
| [UI 交互设计](design/game-ui-interaction-design.md) · [交互规范](ui/interaction-guidelines.md) | 牌桌、操作、弹窗和可访问性 |
| [交互原型](ui/interaction-prototype.html) | 独立设计演示，保留原型回归测试 |
| [历史、复盘与配置关系](design/history-and-profiles.md) | 数据归属与隔离原则 |
| [System One 演进](design/laya-engine.md) | 输入、指引和扣底建模候选 |
| [开发路线](planning/development-roadmap.md) | 当前能力与后续方向的统一状态入口 |
| [熟人 P2P 联机演进](planning/multiplayer-and-monorepo.md) | WebRTC、NAT、中继、大厅、替补与语音 |
| [后续方向](planning/future-directions.md) · [AI 研究验收](planning/ai-research.md) | 产品、平台和研究候选 |

## 维护

[文档维护约定](maintenance/document-governance.md) · [Git 文件管理](maintenance/git-tracking-policy.md) · [开发技能安装](skills/README.md) · [AI 评测技能源码](skills/yaozifen-ai-evaluation/SKILL.md)
