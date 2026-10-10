# 保山幺子分 · baoshan-yaozifen

[![CI](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml/badge.svg)](https://github.com/zxrneu/baoshan-yaozifen/actions/workflows/ci.yml)

云南保山地区流行的四人搭档吃分纸牌游戏 **幺子分**（也写作"腰子分"）的开源实现。
纯 TypeScript 编写的规则引擎 + React 牌桌界面 + 可见信息蒙特卡洛 AI，附带完整测试。

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
   本实现中先胜 `targetWins`（默认 5）副的一方赢得整场。

### 简化与未实现项
- 未实现"抠底翻倍"（末轮庄家方拿底则底牌分翻倍）等地方变体；
- 未实现反主、闷牌、"幺子"特殊牌型等规则（资料不足，留待社区补充）。

## 出牌策略分析

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
pnpm dev        # 启动开发服务器（默认 http://localhost:5173）
pnpm test       # 运行 Vitest 测试
pnpm build      # 类型检查 + 生产构建
```

你是南家（下方），其余三家由 AI 扮演。操作流程：叫分 →（若你坐庄）定主 → 扣底 → 出牌。

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
src/
  cards.ts            牌张定义：花色/点数/分值/牌力、洗牌、可复现 RNG
  engine/             规则引擎（纯函数状态机，无 UI 依赖）
    types.ts          领域类型与座位常量
    rules.ts          规则配置 + 可插拔结算策略（ScoringRule，地方变体在此接入）
    trick.ts          轮内比较（beats / trickWinner）
    game.ts           状态机：发牌/叫分/定主/扣底/出牌/副间推进
  ai/                 可插拔 AI（实现 PlayerAgent 接口即可换策略）
    types.ts          AiAction、同步 PlayerAgent 与独立异步扩展
    heuristic.ts      启发式实现：估值叫分、定主、扣底、出牌
    smart.ts          原有搜索 Agent（保留用于比较与兼容）
    optimized/        观察、约束采样、模拟、配对搜索、信念残局与 Worker
    optimizedAgent.ts 同步 / 异步 Agent 适配器
    browserAgent.ts   浏览器组合根，默认异步搜索
  hooks/useGame.ts    对局编排：状态、AI 驱动、人类操作 → 引擎调用
  components/         展示组件（窄 props，按对局阶段分派）
  App.tsx             薄组合层
tests/                Vitest 测试（规则、AI 合法性、全场模拟、分数守恒）
```

引擎与 AI 均与 UI 完全解耦：`engine/` 可独立用于联机服务端、回放、AI 训练；
换更强的 AI 可实现 `PlayerAgent`；耗时出牌策略可实现 `AsyncPlayerAgent`。
默认牌桌在 Worker 中使用优化搜索；叫分、定主、扣底继续使用原有策略。
100 分明牌局中，AI 观察包含公开搭档的剩余手牌，采样固定这些牌的归属，推演及残局搜索持续更新明牌；闲家 AI 同样可以利用这份公共信息。扣底前的叫分、定主和扣底决策不能提前读取搭档手牌。
默认搜索预算为 250 ms、最多 1024 个样本；无 Worker 或搜索未完成热身时使用合法的快速兜底。

## 测试覆盖

- 牌张：52 张唯一、分值合计 100、牌力与理牌、RNG 可复现；
- 引擎：叫分档位与越序校验、四家不叫重发、定主/扣底校验（分牌不可扣底）、
  跟牌强制、主牌压制、整场流程与"先胜 N 副"收场；
- AI：全部动作经引擎校验合法、多种子全场模拟、吃分守恒（庄+闲+底 = 100）。
- 优化 AI：暗牌隔离、DP 均匀采样、模拟器与引擎逐步一致、搭档超车反例、
  多暗牌残局与独立穷举一致、配对检查点、预算中断与 Worker 生命周期。
- 100 分明牌：扣底后公开庄家搭档、四座位信息隔离、固定明牌采样、推演同步、换副重置和闲家保分策略。

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
