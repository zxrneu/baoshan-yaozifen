# 保山幺子分 · baoshan-yaozifen

[![CI](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml/badge.svg)](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml)

云南保山地区四人搭档吃分纸牌游戏“幺子分”的开源实现。React + TypeScript 牌桌、纯函数规则引擎、四类 AI 决策引擎，支持 SQLite 对局历史、逐步复盘、多配置引擎与模拟对战，并提供 Tauri 跨端打包入口。

## 快速开始

运行环境：Node.js **>=22.16.0**、pnpm **9.15.4**；CI 使用 Node 24。版本要求以 [package.json](package.json) 为准。

```bash
git clone https://github.com/zxrneu/baoshan-yaozifen.git
cd baoshan-yaozifen
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

默认地址为 `http://localhost:5173`。`pnpm dev` 同时提供前端与 `/api`；需要模型服务时，复制 [.env.example](.env.example) 为 `.env` 并配置端点和密钥。启动前会检查内置 SQLite 的打开与备份能力。

默认玩家坐南家，其余座位由 AI 行动：叫分 → 定主 → 拿底 / 扣底 → 出牌 → 结算。规则为项目 `basic-v1`，各地玩法可能不同；规则、变体边界与来源见[玩法规则](docs/guides/rules.md)。

## 已有能力与使用入口

| 能力 | 入口与说明 |
| --- | --- |
| 普通对局、独立单副练习、音效、报牌、皮肤 | [玩家指南](docs/guides/playing.md) |
| 四座 AI 观战、暂停与单步、查看决策原因 | [观战与动作展示](docs/features/ai-spectator-actions.md) |
| 自动存档、历史筛选、校验导出、恢复未结束副牌 | [历史存储](docs/features/history-storage.md) |
| 结算一键复盘、时间线、观察与诊断、反事实分支 | [历史复盘](docs/features/history-replay.md) |
| 多 LLM / System One / Bridge / Algorithm 配置、四座独立选择 | [引擎配置](docs/features/engine-profiles.md) |
| 独立续打、同种子换边批跑、取消续跑与报告复盘 | [模拟对战](docs/features/simulations.md) |

历史持久化依赖 Node 服务；Tauri 无 Node 服务的纯离线原生历史与历史文件导入尚未实现。普通 AI 只接收阶段合法观察；100 分合同成功扣底后，庄家搭档的剩余手牌公开并持续同步。透视显示和全牌复盘不扩大普通 AI 的输入。

## 开发与文档

[文档索引](docs/README.md)按任务导航，并区分当前说明、候选设计和历史证据。

| 要做的事 | 从这里开始 |
| --- | --- |
| 启动、测试、浏览器回归、Tauri 打包 | [开发指南](docs/guides/development.md)、[AGENTS.md](AGENTS.md) |
| 理解决策、RPC、配置与信息隔离 | [决策架构](docs/architecture/decision-engines.md)、[信息边界](docs/architecture/information-isolation.md) |
| 运行 AI 评测、核对结果与证据 | [评测操作手册](docs/ai/evaluation-runbook.md)、[评测方案](docs/ai/evaluation-plan.md) |
| 查看待办、依赖和验收条件 | [TODO](TODO.md)、[开发路线](docs/planning/development-roadmap.md) |
| 查产品与 UI 设计、历史方案 | [设计文档](docs/README.md#设计与候选方案)、[历史归档](docs/archive/README.md) |

交付检查：

```bash
pnpm test
pnpm build
# 修改 src-tauri/ 时另跑：
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

功能与行为修改遵循测试先行，具体约束见 [AGENTS.md](AGENTS.md)。测试数量与构建结果以本次实跑和 CI 为准；历史报告中的数字只代表当时验证。

欢迎通过 [Issue](https://github.com/zxrneu/baoshan-yaozifen/issues)反馈规则或功能问题，或提交 Pull Request。[MIT](LICENSE) © baoshan-yaozifen contributors
