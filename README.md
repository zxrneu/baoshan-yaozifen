# 保山幺子分 · baoshan-yaozifen

[![CI](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml/badge.svg)](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml)

云南保山地区流行的四人搭档吃分纸牌游戏 **幺子分**（也写作"腰子分"）的开源实现。
纯 TypeScript 编写的规则引擎 + React 牌桌界面 + Client/Server 决策服务架构 + 可插拔全阶段 AI 决策体系（桥牌启发式深度思考 / 约束采样蒙特卡洛 / 非自回归小模型 / 大语言模型 / 自博弈 RL 规划），附带完整测试与 Tauri v2 一码三端支持。

> ⚠️ **规则版本说明**：本项目规则为 **v1 初版**，依据公开网络资料整理而成（来源见下文）。
> 各地、各牌桌的细则可能存在差异（如抠底是否翻倍、叫分档位、是否允许"反主"等）。
> 欢迎熟悉本地玩法的朋友提 Issue / PR 修正细则。

## 玩法规则（v1）

### 基本设定
- **4 人、两搭档**：座位为东、南、西、北，**东西一方 vs 南北一方**，逆时针出牌。
- **一副 52 张扑克牌**（无大小王），发给每人 **12 张**，留 **4 张底牌**。
- **分牌**：`A`、`10` 每张 10 分，`5` 每张 5 分；每门花色 25 分，全副合计 **100 分**。
- 牌力（同花色内）：`A > K > Q > J > 10 > 9 > … > 2`。

### 一局流程
1. **叫分**：从发牌者下家开始轮流叫分，最低 70 分、步长 5、最高 100 分；
   最高叫分者成为 **庄家**。四家均不叫则重新发牌（庄家顺延）。
2. **定主**：庄家从四门花色中选一门作为 **主牌**。
3. **拿底 / 扣底**：庄家拿进 4 张底牌（手牌变为 16 张），再扣回 4 张作为新底牌；
   **分牌（A/10/5）不能扣回底牌**。
   **叫到 100 分时，成功扣底后庄家的搭档明牌，剩余手牌对所有玩家可见；其他手牌和底牌仍按原规则隐藏。**
4. **出牌**：庄家首先出牌，共 12 轮；**四家各出一张牌算一轮**。
   - 有所出花色的牌时 **必须跟同门**；
   - 缺门时可用 **主牌杀**，也可垫其他牌（垫牌不计大）；
   - 主牌压过任何非主牌；同为非主且不同门时不能互相压制；
   - 四家出完后，牌最大的一家收走本轮的牌和分数，并在下一轮首先出牌。
5. **结算**：庄家方吃分 + 底牌分 ≥ 叫分即 **成局**，否则闲家方胜本副。
   - **胜负锁定提前结算**：四家出完一轮入账后实时判定——若庄家方吃分达到叫分 $B$ 或闲家方达到 $105 - B$，本副立即提前锁定胜负并结算，剩余未打出分计入未打出分统计，玩家手牌完整保留。
     - $105 - B$ 是**精确**锁定阈值，不是保守估计：分牌只有 A/10=10 分、5=5 分，故任意累计吃分恒为 5 的倍数；令闲家吃分为 $D$，庄家不成局 $\iff 100 - D < B \iff D > 100 - B$，而 $D$ 与 $100-B$ 同为 5 的倍数时该式等价于 $D \ge 105 - B$。请勿改为 $101 - B$（该值不可达，属无效改动）。
   先胜 `targetWins`（默认 5）副的一方赢得整场。

### 简化与未实现项
- 未实现"抠底翻倍"（末轮庄家方拿底则底牌分翻倍）等地方变体；
- 未实现反主、闷牌、"幺子"特殊牌型等规则（资料不足，留待社区补充）。

## 出牌策略分析

[全阶段 AI 引擎与模型评估方案](./docs/ai-engine-model-evaluation-plan.md)：35 个场景、统一裁判、配对实战、版本指纹、诊断日志与可运行命令。

[最新评测结果与修复记录](./docs/ai-engine-model-evaluation-results.md)：三引擎实测、模型历史证据、选型结论及统计限制；原始报告与日志见[评测产物索引](./experiments/results/engine-model-eval/README.md)。

[LLM 提示词优化记录](./docs/llm-prompt-optimization.md)：四阶段Prompt 2.0、真实模型同配置对照、关键失误与验证边界。

[开发待办](./TODO.md)：实战 AI 改进优先级、自训强化学习 (RL) 团队奖励与动作掩码规划、问题牌局回放与验收方向。

[开发行动路线（里程碑）](./docs/development-roadmap.md)：按「质量底线 → 产品重塑 → 工程巩固 → 未来演进」四阶段推进的任务清单（T0/T1/T2/T3 + E1–E7 评测任务 + G1–G8 补充建议），含每项位置、方案与验收条件，以及**真实完成状态**（T0.1 扣底兜底已修，含严重度实测修正）。

[决策引擎架构与算法研究](./docs/decision-engines-and-rl.md)：Client/Server 决策服务架构、SOLID 原则、全阶段决策 RPC 契约（叫分/定主/扣底/出牌）、桥牌启发式深度思考（Bridge / DDS）、非自回归小模型（TypeSafe / Ollaya `laya:multilingual`）、大语言模型（vLLM / `qwen38_27b`，支持思考等级 `reasoning_effort` 调节）、双重优雅降级与自博弈强化学习 (RL) 规划。

[桥牌启发式出牌算法（无模型深度思考）](./docs/bridge-inspired-ai-algorithm.md)：桥牌博弈论映射、位棋盘加速、双明手 Alpha-Beta 求解器 (DDS) 与专家战术体系。

[当前规则下的最优出牌](./docs/optimal-play-strategy.md)：获胜线推导、胜率与期望得分的区别、搭档超车反例、记牌与主牌策略，以及现有 AI 的局限和验证方法。

[出牌 AI 优化算法设计](./docs/optimized-ai-algorithm.md)：可见信息隔离、动态规划约束采样、配对胜率搜索、自适应预算与残局求解，以及接入和验证方案。

[优化 AI 实现与 SOLID 设计](./docs/optimized-ai-implementation.md)：已接入默认牌桌的模块职责、接口注入、Worker 取消、使用方法、验证结果及适用边界。

[AI 出牌延迟诊断与优化策略](./docs/ai-latency-optimization.md)：显示等待、搜索预算与 Worker 生命周期的诊断、可复现延迟基准，以及分阶段优化和验收标准。

## 规则来源

- [知乎《云南酒吧小游戏大全》§8 保山腰子分](https://zhuanlan.zhihu.com/p/629847362) —— 主要依据：
  四人两两搭档、发 12 张留 4 张底牌、叫分定庄、选主、拿底扣底（A/10/5 不可扣底）、
  缺门可杀、吃分结算。
- 百度文库相关词条摘要（"腰子分"玩法）作为交叉印证。

若你熟悉真实玩法并发现出入，非常欢迎提交修正——本项目的目标之一就是把这门地方玩法
用开源的方式记录清楚。

## 快速开始

环境要求：Node.js 22 或以上（推荐 24 LTS），pnpm 9.15.4。

```bash
git clone https://github.com/zxrneu/baoshan-yaozifen.git
cd baoshan-yaozifen
corepack enable
pnpm install --frozen-lockfile
pnpm dev        # [推荐] 启动全功能开发服务器（单命令合一：内置 API 中间件，默认 http://localhost:5173）
# 或前后端解耦双终端启动：
pnpm server     # 终端1：启动决策与模型代理（默认端口 3001，自动加载 .env 专属 GPU/模型节点）
pnpm client     # 终端2：启动前端客户端开发界面（反向代理连接 pnpm server）
pnpm test       # 运行全部 Vitest 测试
pnpm build      # 类型检查 + 生产构建
```

你是南家（下方），其余三家由 AI 扮演。操作流程：叫分 →（若你坐庄）定主 → 扣底 → 出牌。

### 架构模式与离线可用性
- **Client/Server 决策架构**：系统默认采用 C/S 决策模式。前端通过 `/api/decision` 向服务端发起统一 RPC 请求，服务端统合各决策引擎（Bridge / Algorithm / Laya / LLM），并在上游模型超时或异常时在服务侧进程内毫秒级降级至 `BridgeEngine`。此架构消除了浏览器直接调用本地模型时的跨域 (CORS)、Chrome 私有网络访问 (PNA) 阻断以及 `AbortError: signal is aborted without reason` 报错。
- **全阶段 AI 决策覆盖**：AI 决策体系覆盖对局的**全部阶段**：叫分 (Bidding)、定主 (Declaring Trump)、扣底 (Burying Kitty)、出牌 (Trick Play)。各引擎在各个阶段均输出合法且富有策略深度的动作。
- **纯本地单机与离线游玩**：系统遵循里氏替换与优雅降级设计。若未启动服务端代理（例如离线环境或移动端纯单机），前端自动无缝降级为纯前端本地决策（默认桥牌高胜率算法 `BridgeEngine`），Tauri 桌面与手机端无依赖原生可玩。

牌桌右侧工具栏点击「AI 引擎」可随时在**桥牌深度思考算法**、**非自回归模型 (TypeSafe / Laya `laya:multilingual`)**、**大语言模型 (vLLM / `qwen38_27b`)**、**传统采样搜索**间统一切换三个自动座位，开启/关闭服务端决策托管，配置 OpenAI 思考等级 (`reasoning_effort`)，测试网络连通性与一键导出结构化决策 JSON。

不能出的手牌用不透明的灰色牌面标识，并显示跟牌或扣底限制；等待其他玩家时保留正常牌面。100 分明牌局中，公开手牌紧贴对应玩家的头像，使用和自己手牌相同的扑克牌面叠放，空间不足时连续换行。

右上角「换皮肤」可即时切换经典棋牌（默认青绿绒面与红木围边）、森林绿和午夜蓝。选择会保存在本机，刷新后恢复；换肤保留当前对局与选牌。皮肤变量统一放在 `src/styles/skins.css`，皮肤列表位于 `src/themes.ts`。

## 三端 App（Tauri v2，一码三端）

本项目已接入 Tauri v2，一套 Web 代码可打包 Android / iOS / macOS。

| 命令 | 说明 |
| --- | --- |
| `pnpm app:dev` | 桌面端开发模式（热更新） |
| `pnpm app:build` | 打 macOS `.app` / `.dmg`（本机可直接验证） |
| `pnpm app:android` | 打 Android debug APK（侧载安装） |
| `pnpm app:ios` | 打 iOS 包（**需要完整 Xcode + Apple Developer 账号**） |

环境要求：Rust 稳定版 + 对应平台 target、
Android SDK（`~/Library/Android/sdk`）+ NDK 27、Java 17。
首次打安卓包时 Gradle 会自动下载依赖，需要能正常访问 dl.google.com。

> 当前状态：Android 走 debug APK 侧载；iOS 需在装有完整 Xcode 的机器上打包并用
> 99 美元/年 Apple Developer 账号签名后经 TestFlight / App Store 分发；
> macOS 可先 unsigned 分发，上架 Mac App Store 才需签名公证。

## 项目结构

```
server/                 Node 后端决策服务与模型代理（vite-node 运行）
  apiHandler.ts         核心 API 请求处理器（无框架依赖，供 Vite dev 中间件及独立 proxy 共用）
  proxy.ts              独立服务入口：挂载 /api/decision 统一路由、模型转发与静态托管
  controllers/          HTTP 控制器（decisionController.ts 处理请求分发与校验）
  services/             决策业务服务（decisionService.ts 实现全阶段派发与服务侧秒级降级）
  engines/              服务端决策引擎注册表（serverEngineRegistry.ts）
  types.ts              服务端类型定义
src/
  cards.ts              牌张定义：花色/点数/分值/牌力、洗牌、可复现 RNG
  engine/               规则引擎（纯函数状态机，无 UI 依赖）
    types.ts            领域类型与座位常量
    rules.ts            规则配置 + 可插拔结算策略（ScoringRule，地方变体在此接入）
    trick.ts            轮内比较（beats / trickWinner）
    game.ts             状态机：发牌/叫分/定主/扣底/出牌/副间推进
  ai/                   可插拔 AI 体系（全阶段动作决策与多引擎架构）
    types.ts            AiAction、同步 PlayerAgent 与异步扩展
    heuristic.ts        规则基线启发式：叫分、定主、扣底、出牌
    tactics.ts          战术判断与保牌候选精简（搭档稳赢判定与 ♦K 保留）
    bridge/             桥牌启发式深度思考引擎（默认算法引擎，无模型高胜率）
      bitboard.ts       64位纳秒级位棋盘运算与手牌集合表示
      heuristics.ts     桥牌专家战术规则（拔主、兑现赢张、第二手出小、第三手出大、第四手便宜拿）
      dds.ts            双明手极小化极大 Alpha-Beta 求解器（等价牌压缩与成局硬截断）
      pimc.ts           基于 DDS 的分割完美信息蒙特卡洛主控
    engines/            统一全阶段决策引擎体系
      decisionProtocol.ts 跨端 RPC 决策协议与阶段定义（Bidding/Trump/Burying/Playing）
      remoteEngine.ts   Client/Server 客户端决策代理（支持本地 BridgeEngine 离线降级）
      engineTypes.ts    DecisionEngine 接口定义与 safeAnySignal（防止 reason 丢失报错）
      bridgeEngine.ts   桥牌深度思考引擎实现
      algorithmEngine.ts 约束采样与残局求解引擎实现
      layaEngine.ts     TypeSafe / Ollaya 非自回归小模型适配器（laya:multilingual）
      llmEngine.ts      OpenAI / vLLM 大语言模型适配器（qwen38_27b，支持 reasoning_effort）
      engineAdapter.ts  EnginePlayerAgent 适配器（连接游戏循环与全阶段决策）
      engineSettings.ts 决策引擎配置持久化与服务端托管开关
      decisionLogger.ts 统一决策日志采集与指标导出
    eval/               全阶段场景、数据校验、评测执行器、指纹与复式统计
    optimized/          观察投影、约束采样、配对搜索与 Web Worker
  hooks/useGame.ts      对局编排：状态、AI 驱动、人类操作 → 引擎调用
  components/           展示组件（窄 props，按对局阶段分派）
  App.tsx               薄组合层
tests/                  Vitest 测试集（规则、策略、服务生命周期与评测完整性）
```

引擎与 AI 均与 UI 完全解耦：`engine/` 可独立用于联机服务端、回放、AI 训练；
换更强的 AI 可实现 `PlayerAgent`；耗时策略可实现 `DecisionEngine` 并挂载于 Client 或 Server。
全阶段决策体系支持对局全流程智能驱动；100 分明牌局中，AI 观察包含公开搭档的剩余手牌，采样固定这些牌的归属，推演及残局搜索持续更新明牌。扣底前的叫分、定主和扣底决策严格保证信息隔离，不提前读取搭档暗牌。

## 测试覆盖

最近一次验证（2026-10-12）：26 个测试文件、318 项测试通过，同时通过 TypeScript 检查与生产构建。主要覆盖：

- **牌张基础**：52 张唯一性、分值合计 100 分、牌力比较与理牌、可复现 RNG；
- **规则引擎**：叫分档位与越序校验、四家不叫重发、定主/扣底合法性（分牌禁止扣底）、跟牌强制、主牌压制、整场流程与"先胜 N 副"收场、胜负锁定实时提前结算与 7 个叫分档位边界校验；
- **比大小与轮次结算**：同门比大、缺门杀牌与垫牌胜负、首家领出权转移、吃分归属；
- **战术保牌与搭档协作**：搭档稳赢判定、无收益高牌精简、经典截图回归用例（西家 ♦A、北家 ♦J、东家持 ♦K 与 ♦2 均出 ♦2）、安全喂分、保留大主、后手绝门杀牌反例与两轮超车反例；
- **桥牌算法与位棋盘**：64 位无符号位棋盘加减牌与花色掩码运算、桥牌战术规则器（拔主、长套兑现、第二手出小、第三手争墩/喂分、第四手便宜拿）、双明手极小化极大 (Alpha-Beta / DDS) 搜索与置换表得分隔离、全场对局分数守恒；
- **决策引擎体系与全阶段**：OpenAI Chat 与 Legacy Completions 协议解析、思考等级 `reasoning_effort` 注入、TypeSafe `/v1/systemone` 适配（默认 `laya:multilingual`）、全阶段动作决策（叫分/定主/扣底/出牌）、单候选直接出牌、HTTP 500 自动回退、非法牌回退与指标隔离导出；
- **Client/Server 决策协议与降级**：`/api/decision` RPC 端点契约、全阶段服务分发、上游异常/超时服务侧进程内毫秒级回退至 `BridgeEngine`、多引擎动态路由；
- **安全取消与信号链**：`safeAnySignal` 解决现代浏览器/Node 中 AbortSignal 丢弃 reason 导致的 `signal is aborted without reason` 报错，安全支持超时与外部中止；
- **约束采样与优化 AI**：暗牌隔离、DP 均匀采样、模拟器与引擎逐步一致、搭档超车反例、多暗牌残局与独立穷举一致、配对检查点、预算中断与 Worker 生命周期；
- **评测完整性**：35 场景数据与裁判、DDS 截断续打、跟牌行动座位、实际赢副与组级区间、缓存指纹、冻结输入和无密钥日志。
- **100 分明牌对局**：扣底后公开庄家搭档、四座位信息隔离、固定明牌采样、推演同步、换副重置和闲家保分策略。

实际对打实验独立于常规测试：

```bash
OPTIMIZED_EVAL_GROUPS=256 pnpm vitest run -c experiments/vitest.config.ts experiments/optimized.test.ts
```

实验固定叫 70 分、使用独立发牌种子并交换双方；结果写入 `experiments/results/`。
默认实验预算为每次最多 32 个样本、不限总搜索时间，用于算法对照；不代表牌桌 250 ms 预算的设备性能。

## 许可

[MIT](./LICENSE) © baoshan-yaozifen contributors

## 持续集成与贡献

[GitHub Actions CI](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml) 在每次 push、Pull Request 和手动触发时运行：

- Ubuntu：按锁文件安装依赖，运行全部常规测试、TypeScript 检查和 Web 生产构建。
- macOS：构建前端后使用 Rust 稳定版执行 `cargo check --locked`，检查 Tauri 桌面代码。

耗时对打实验仍使用上文的独立配置。移动端打包与应用签名需要相应开发环境，当前 CI 不包含签名发布。

欢迎通过 [Issue](https://github.com/zxrneu/baoshan-yaozifen/issues) 反馈规则或功能问题，也欢迎提交 Pull Request。
提交前请运行 `pnpm test` 和 `pnpm build`；修改 Tauri 代码时再运行 `cargo check --locked --manifest-path src-tauri/Cargo.toml`。
