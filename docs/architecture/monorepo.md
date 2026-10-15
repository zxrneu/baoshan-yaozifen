# 工作区结构与运行边界

> 文档类型：当前实现说明；复核日期：2026-10-16。当前结构保留本地玩法、引擎配置和历史数据语义；多人联机尚未实现。后续联机设计见[演进方案](../planning/multiplayer-and-monorepo.md)，返回[文档索引](../README.md)。

## 工作区

根包仅负责命令编排、集中测试与开发工具；全部内部包为 private，统一使用 `workspace:*` 和根 `pnpm-lock.yaml`。当前保持 pnpm 9.15.4、Node >=22.16.0 与既有第三方解析版本；正式声明已有工具链使用的 Node 类型依赖，没有新增运行时依赖。

| 工作区 | 职责 | 主要依赖 |
| --- | --- | --- |
| `apps/web` / `@yaozifen/web` | React 牌桌、交互、音频、皮肤、Vite 应用 | 共享包；开发 API 适配依赖 server |
| `apps/server` / `@yaozifen/server` | HTTP API、模型代理、配置、SQLite、模拟编排、静态服务 | AI、历史、规则、观察、协议 |
| `packages/game-core` | 牌张、纯函数规则和结算 | 无运行时外部依赖 |
| `packages/game-view` | 四阶段观察投影、出牌观察与白名单 | game-core |
| `packages/protocol` | 会话身份、动作、历史记录与纯编码/校验 | game-core、game-view |
| `packages/ai-core` | 启发式、Bridge/Algorithm、模型/远程适配、Worker、引擎配置与诊断 | core、view、protocol；OpenAI SDK 按需加载 |
| `packages/match-runtime` | 现有本地 GameSession、快照与动作展示描述 | core、protocol、ai-core |
| `packages/history-core` | 采集、恢复、HTTP 客户端、复盘/分支、模拟契约与统计 | core、view、protocol、AI、本地会话 |
| `packages/ai-eval` | 场景加载、裁判、覆盖、整副对战与指纹 | core、view、ai-core |

包名均以 `@yaozifen/` 开头。`tests/`、`scripts/`、`data/evaluation/`、`experiments/` 和 `src-tauri/` 保留在根目录；没有为未实现的 client-sdk、多人权威运行时或媒体服务创建空包。

## 依赖约束

- 规则与观察包采用无 DOM、无 Node 全局类型的独立 TypeScript 配置，不引用 React、网络、AI 或存储。
- 纯历史记录与会话提交类型归属 protocol；HistoryRepository 存储端口留在 history-core，避免协议反向引用运行时。
- AI 的 PlayerObservation 类型由 game-view 提供；决策日志使用 protocol 的 SessionCommit。history-core 与 match-runtime 消费 AI，AI 不反向依赖它们。
- 换边统计是 ai-core 的纯统计模块；运行时不依赖 ai-eval，完整评测数据不进入牌桌构建。
- 各包声明自己的依赖并使用显式 exports 子路径。根测试可使用应用的源码测试入口，应用之间不共享全局状态；Web 开发 API 经 Vite SSR 转换加载 server TS。
- 现有 AI RPC 仍在 ai-core 的 decisionProtocol 入口中。它依赖引擎响应、profile 和模型选项，未为满足目录名强行重写为另一套协议；未来联机 wire DTO 再按方案独立设计。

这是现有本地运行时的模块化，不代表已实现房主权威、断线恢复或多人信息分发。完整状态仍只用于当前本地规则、工作台和私有历史；AI 继续接收阶段合法观察。

## 命令和路径兼容

| 根命令 | 当前执行与产物 |
| --- | --- |
| `pnpm dev` | web 工作区开发入口；SQLite 前置检查、默认 5173 与内置 `/api` 保持 |
| `pnpm client` | web 独立客户端模式，代理 `/api` 至独立 Node 服务 |
| `pnpm run server` / `pnpm proxy` | server 的 vite-node 入口；默认 127.0.0.1:3001；显式 `run` 避免 pnpm 同名内置命令 |
| `pnpm test` / `pnpm test:watch` | 根 Vitest 配置，统一发现 `tests/**/*.test.ts` |
| `pnpm typecheck` | 所有工作区独立类型检查，再检查根测试、脚本与配置 |
| `pnpm build` | 完整类型检查，再按依赖顺序打包 Node 与 Web 应用 |
| `pnpm preview` | 预览根 `dist/` 中的前端 |
| `pnpm start` | 新增生产入口，执行 `apps/server/dist/proxy.js`，同时提供 API 与根 `dist/` 静态页面 |
| `pnpm test:browser` | 使用 web 配置启动隔离服务；临时 SQLite 与离线 profile 保持 |
| `pnpm eval:*`、`pnpm app:*` | 原评测和 Tauri 命令保持 |

工作区的开发/启动脚本从仓库根执行，因此 `.env`、相对 `GAME_DB_PATH`、`ENGINE_PROFILES_PATH` 和默认 `data/history.db` 沿用原位置。`pnpm --filter @yaozifen/web dev`、`pnpm --filter @yaozifen/server dev` 也使用相同语义。直接执行内部源码时，应从仓库根运行。

Web 的应用根为 `apps/web`，源码入口为该目录的 `index.html`；生产前端仍输出根 `dist/`。Tauri 保留根 `src-tauri/`、`../dist` 与现有 beforeDev/beforeBuild 命令。Node 生产产物输出 `apps/server/dist/`，不覆盖前端产物。

共享包使用源码 exports，由 Vite/vite-node 转换；生产 Node 构建将共享 TS 打入服务产物，`openai` 等第三方依赖及 Node 内置模块外置。生产运行需要安装相应工作区依赖；当前交付为整个仓库部署，未声明支持单独复制一个 server.js 即可运行。

根 `vite.config.ts` 用于 Node 脚本/实验转换，Web 应用配置在 `apps/web/vite.config.ts`，常规测试配置在根 `vitest.config.ts`。浏览器回归显式选择 Web 配置，夹具仍位于根 `tests/fixtures/`，仅在 browser-test 模式提供经过 React 转换的 HTML 与模块定位，避免脚本入口随应用根移动。

## 评测与数据兼容

历史协议、SQL schema、规则版本与冻结 profile 各自独立；评测输出默认忽略，固定输入保留在 data/evaluation。源码路径变化会改变 codeHash/sourceHash，因此旧模拟与新源码不兼容时继续明确拒绝混合续跑。

模拟与评测的源码采集已覆盖 `apps/*/src`、`packages/*/src` 及各工作区 package/tsconfig；评测继续包含根脚本。扫描不进入 node_modules 或 dist，不把安装/构建产物纳入实现指纹。固定 JSON 场景仍位于 `data/evaluation/`。

独立实验与通用评测共享工作区包；旧指纹不能与当前结果混合续跑。输出、检查点和日志按[文件管理约定](../maintenance/git-tracking-policy.md)保存在本地。

## 验证方式

规则/观察包采用独立类型检查；`tests/workspace-boundaries.test.ts` 实际构建浏览器消费者，阻止规则/观察依赖 AI 或 Node，并阻止完整牌桌加载 server、ai-eval 与评测数据。

交付运行 `pnpm test`、`pnpm build`、浏览器回归、冻结锁文件安装与独立服务冒烟。结果以实际输出与 CI 为准。
