# 开发与验证指南

> 文档类型：当前操作指南；复核日期：2026-10-16。开发约束见 [AGENTS.md](../../AGENTS.md)，返回[文档索引](../README.md)。

## 安装与运行

Node.js 下限、pnpm 版本和实际脚本以 [package.json](../../package.json) 为准；CI 环境与检查见 [ci.yml](../../.github/workflows/ci.yml)。当前 Node 下限为 22.16.0，使用内置 `node:sqlite` 的打开和备份能力，模块可能输出实验性警告。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev         # Vite + 内置 /api，默认 5173
```

分开运行时，在两个终端分别执行 `pnpm run server`（默认 3001；`pnpm proxy` 为同义命令）和 `pnpm client`（反向代理 `/api`）。`pnpm dev`、`run server`、`proxy` 的启动前检查会实际打开临时库并校验备份。

独立服务默认监听 `127.0.0.1:3001`。API 校验本机连接、Host 与 Origin，拒绝跨站调用模型和写入配置；不发送通配 CORS。需要跨源前端时，在 `.env` 的 `API_ALLOWED_ORIGINS` 中填写明确的完整来源（如 `http://localhost:5173`），多个来源用逗号分隔。`HOST` 仍可显式配置，允许来源只应填写可信前端。

复制 [.env.example](../../.env.example) 为 `.env` 配置模型服务、端口与历史库；默认历史文件为 `data/history.db`。多配置使用 [engine-profiles.example.json](../../engine-profiles.example.json)及[配置说明](../features/engine-profiles.md)。密钥和公网端点从环境解析，本机配置不加入 Git。

## 交付检查

```bash
pnpm test        # tests/**/*.test.ts
pnpm build       # 各包与根类型检查 + Node/Web 生产构建
```

功能、行为修改及 bug 修复遵循红 → 绿 → 重构；纯文档和不改变行为的注释无需制造失败测试，仍执行上述检查。修改 `src-tauri/` 另跑：

```bash
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

浏览器回归首次安装 Chromium，然后运行：

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

浏览器回归使用临时 SQLite 和离线 Bridge 配置，不读取玩家 `.env`。覆盖阶段操作、刷新复盘、分支及保存失败重试；截图、trace 与报告位于 `output/playwright/`。CI 的 Ubuntu 作业包含常规测试、构建和浏览器回归，macOS 作业构建前端并检查 Tauri。覆盖与技能应用记录见[开发指南](development.md)。

`experiments/` 使用独立 Vitest 配置，不属于 `pnpm test`；运行 AI 实验见[评测操作手册](../ai/evaluation-runbook.md)。当前公开场景数量与版本以[评测方案](../ai/evaluation-plan.md)及[数据](../../data/evaluation/)为准；历史结果保留其自身指纹。

## 模块导航

当前使用 pnpm workspace，完整依赖方向、源码 exports、环境/数据路径与构建约定见[工作区结构](../architecture/monorepo.md)。根命令保持；也可通过 `pnpm --filter @yaozifen/web dev`、`pnpm --filter @yaozifen/server dev` 单独启动应用。生产构建后执行 `pnpm start` 同时提供 API 与根 `dist/` 页面。

| 目录 | 职责 |
| --- | --- |
| `packages/game-core/src/`、`packages/game-core/src/cards.ts` | 纯函数规则状态机与牌张基础 |
| `packages/game-view/src/`、`packages/protocol/src/` | 合法观察投影、共享历史/会话契约与编码 |
| `packages/ai-core/src/` | 启发式、Bridge / Algorithm 搜索、模型适配与 Worker |
| `packages/ai-eval/src/` | 评测场景、裁判、覆盖与整副对战 |
| `packages/match-runtime/src/`、`apps/web/src/hooks/` | 会话提交、工作台与 UI 编排 |
| `packages/history-core/src/` | 历史仓储契约、采集、重放与 HTTP 客户端 |
| `apps/server/src/` | 决策、配置、模型代理、SQLite 历史及模拟服务 |
| `apps/web/src/components/`、`apps/web/src/styles/` | 展示组件与样式 |
| `tests/`、`scripts/`、`experiments/` | 行为回归、运行入口与独立实验 |

规则引擎不依赖 UI、AI 或网络；历史完整状态只用于恢复和规则校验，AI/RPC 接收阶段观察。进一步阅读[决策架构](../architecture/decision-engines.md)、[信息隔离](../architecture/information-isolation.md)及各[功能说明](../README.md#使用与架构)。

## Tauri 打包

| 命令 | 用途 |
| --- | --- |
| `pnpm app:dev` | 桌面开发 |
| `pnpm app:build` | 桌面包 |
| `pnpm app:android` | Android debug APK |
| `pnpm app:ios` | iOS 构建 |

需要 Rust 稳定版及对应平台工具链。Android 需要 SDK、NDK 和 Java；iOS 需要完整 Xcode 及相应签名环境，实际版本以项目平台配置为准。已有打包入口不代表所有平台完成发布验收，CI 不执行移动签名发布。无 Node 服务的 Tauri 默认使用本地决策，原生离线历史尚未实现。

文件跟踪、产物归档和本地工具恢复见[Git 管理约定](../maintenance/git-tracking-policy.md)与[开发技能清单](../skills/README.md)。文档维护规则见[治理说明](../maintenance/document-governance.md)。
