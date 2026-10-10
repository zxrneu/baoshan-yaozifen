# 优化出牌 AI：实现与 SOLID 设计

实现日期：2026-10-10。默认牌桌已通过 Web Worker 使用新出牌搜索。叫分、定主、扣底沿用原有 `smartAgent`；优化范围是当前默认规则的出牌阶段。

算法依据见[设计文档](./optimized-ai-algorithm.md)，规则推导与搭档超车反例见[策略分析](./optimal-play-strategy.md)。新算法在可见信息与明确模型内优化赢副概率，不声称已经求得四人暗牌博弈的均衡最优策略。

## 1. 实现了什么

1. `observePlayer` 是真实游戏状态进入搜索的唯一边界。读取自己的手牌、规则公开的明牌、其他手牌的张数、公开记录和庄家本人有权知道的底牌；不传递发牌 seed。
2. 扫描已结束和当前轮的公开出牌，记录确定缺门。DP 用 `bigint` 统计合法完成数量，按分支数量采样其他手牌和未知底牌；底牌必须零分。
3. 搜索从全部合法牌开始，候选共用同一个采样牌局。轻量模拟器复用引擎的牌张比较，后续策略每一步只接收行动者自己的观察。
4. 评价使用己方最终赢副的 0/1 奖励。达到庄家 `B` 或闲家 `105 − B` 分后结束模拟。
5. 在预先确定的样本检查点比较配对胜率差，用联合 Hoeffding 区间淘汰有明确证据的较差候选。未完成检查点的统计整体丢弃，返回上一个完整结果；没有完成热身则快速兜底。
6. 小残局枚举可能牌局，按根玩家能观察到的后续历史分组，再优化该玩家的未来行动。其他座位仍按固定观察策略行动。相同观察中的多个暗牌分配必须采用同一选择。
7. 浏览器搜索在独立 Worker 中运行。取消、超时、执行失败均释放 Worker；返回值校验请求编号和牌的合法性。React 只把结果应用到发起搜索时的同一个状态。
8. 叫到 100 分且成功扣底后，`revealedPartnerSeat` 确定庄家搭档的公开座位。`revealedHand` 向所有观察者提供剩余牌；DP 和旧采样器固定这手牌，模拟随出牌更新，残局观察键保留明牌。快速策略按明牌敌人的实际跟牌约束判断威胁，旧搜索在明牌局解除“永不盖过搭档”的候选限制。叫分、定主与扣底仍不提前看搭档牌；换副和重开恢复暗牌。

## 2. SOLID 如何落实

| 原则 | 实现方式 |
| --- | --- |
| S：单一职责 | 观察、分配采样、走牌模拟、后续策略、统计、搜索协调、残局和 Worker 生命周期各自独立；搜索类不负责发牌或 React 状态。 |
| O：开闭原则 | `createOptimizedSelector` 在组合根装配默认实现；可注入新的 `WorldSourceFactory`、`WorldEvaluator`、`ObservationPolicy` 或 `EndgameSolver`，不修改协调器。 |
| L：里氏替换 | 新同步 Agent 实现原有 `PlayerAgent`；异步 Agent 同时提供原同步契约，原有自定义 Agent 仍可用于牌桌。替代采样器和策略必须满足独立采样、合法牌、纯确定性等明确契约。 |
| I：接口隔离 | 采样、可枚举采样、评价、时间检查、同步选牌和异步选牌使用小接口；普通采样器不必实现枚举，原有 Agent 不必实现异步。 |
| D：依赖倒置 | `PairedCardSelector` 依赖 `SearchDependencies` 中的接口；模拟评价器依赖 `ObservationPolicy`；Agent 依赖选牌接口；Worker 客户端可注入 `SearchWorkerPort` 工厂。 |

实际规则函数与简单数据类型直接复用；没有为每个工具函数增加抽象层。默认实现的组合集中在 [index.ts](../src/ai/optimized/index.ts) 和 [browserAgent.ts](../src/ai/browserAgent.ts)。

## 3. 文件与职责

所有搜索内核文件位于 `src/ai/optimized/`。

| 文件 | 职责 |
| --- | --- |
| `contracts.ts` | 观察、策略、样本、评价、预算与解释结果的小接口。 |
| `observation.ts` | 真实状态投影、缺门、观察合法牌和完整信息键。 |
| `belief.ts` | 容量 DP、合法完成数量、均匀采样及受限枚举。 |
| `computation.ts` | 独立随机源、大整数拒绝采样、截止时间与错误类型。 |
| `policy.ts` | 确定性快速后续策略，启发式仅排序合法牌。 |
| `simulator.ts` | 轻量状态、合法走牌、分数与获胜线、逐步观察投影。 |
| `statistics.ts` | 候选与配对计数、统计副本、联合差异区间。 |
| `pairedSearch.ts` | 全候选搜索、检查点提交、淘汰与预算控制。 |
| `endgame.ts` | 在有限均匀信念状态中优化根玩家的后续行动。 |
| `workerProtocol.ts` | 可序列化消息与最小 Worker 接口。 |
| `worker.ts`、`workerClient.ts` | Worker 入口及取消、消息校验、释放、兜底。 |

[optimizedAgent.ts](../src/ai/optimizedAgent.ts) 负责阶段分派和动作包装；[useGame.ts](../src/hooks/useGame.ts) 负责异步驱动、动画等待和过期状态保护。

## 4. 使用与扩展

脚本可使用同步 Agent，动作仍交给正式引擎校验：

```ts
import { applyAiAction, createOptimizedAgent } from './src/ai';
import { FAST_OPTIMIZED_BUDGET } from './src/ai/optimized';

const agent = createOptimizedAgent({ budget: FAST_OPTIMIZED_BUDGET });
const action = agent.nextAction(state);
if (action) state = applyAiAction(state, action);
```

需要核查搜索依据时直接使用选牌器：

```ts
import {
  createOptimizedSelector, observePlayer, seededSearchRandom,
} from './src/ai/optimized';

const selector = createOptimizedSelector({
  budget: { minWorlds: 8, maxWorlds: 32, timeLimitMs: Infinity },
  dependencies: { random: () => seededSearchRandom(20261010) },
});
const decision = selector.choose(observePlayer(state, seat));
// decision.moves：每个候选的赢副率、样本量和是否仍活跃。
// decision.comparisons：候选对的胜率差及联合区间。
// decision.status、worlds、elapsedMs、diagnostic：结束原因与诊断。
```

上述固定随机源和无限时间只用于可复现实验；实际牌桌使用独立搜索随机源和有限预算。注入策略必须是只依赖观察的纯确定性函数；有随机行为的策略需要先扩展显式随机接口及共同随机流。

`exact` 表示枚举模型内根玩家的最佳后续应对，`separated` 表示统计区间已经分离，`budget` 表示有限样本建议；`fallback` 和 `inconsistent` 有诊断信息。`exact`、`separated` 均不代表对真实未知对手的最优保证。

## 5. 预算和取消

| 配置 | 热身 / 样本上限 | 搜索时间 | 残局限制 |
| --- | --- | --- | --- |
| 默认 | 16 / 1024 | 250 ms | ≤256 个牌局、≤12 张剩余手牌、≤5000 个节点。 |
| 快速预设 | 8 / 32 | 120 ms | 同上，节点上限 2000。 |

残局单次尝试最多占用搜索时间的四分之一，且不超过 50 ms；未完成则回到配对模拟。时间检查进入 DP、采样和模拟内部。时间预算是合作式截止时间，单次操作及调度可能带来少量超出，不能当作设备上的硬实时保证。

Worker 额外设置默认 1500 ms 的传输兜底时限，包括启动和调度。速度切换、状态推进、重开、换副和组件卸载通过 `AbortSignal` 终止旧 Worker；动画等待按已消耗的搜索时间扣减。

## 6. 验证与实验

`pnpm test` 通过 **81 项测试**，其中优化 AI 的 18 项覆盖：

- 用 Proxy 禁止读取任何暗牌值、未知底牌和发牌 seed；同一观察与固定搜索随机源下，改变隐藏归属不会改变完整决策结果。
- 六张牌小模型穷举得到 22 种分配，DP 计数一致；4400 次固定随机源抽样检查，真实中盘检查牌张守恒、缺门与零分底牌。
- 8 个种子的整副逐张模拟与正式引擎一致；3 个种子的优化 Agent 完整对局，所有动作合法且总分 100。
- 搭档超车两轮反例；多个暗牌分配的两轮残局与使用正式规则引擎的独立穷举一致。
- 共用样本、统计淘汰、丢弃未完成检查点、保守模式、胜负锁定和唯一合法牌。
- Worker 只收到观察、忽略其他请求、取消释放、启动失败及超时兜底。

另有 17 项明牌回归覆盖四个庄家座位、扣底前和非法扣底不公开、70–95 分保持暗牌、换副/重开重置、四个观察者的暗牌隔离、明牌固定采样与牌张守恒、矛盾明牌诊断、观察键、整副逐张推演一致，以及闲家根据明牌压牌风险选择保分。浏览器实测 100 分扣底后出现 12 张明牌，出完第一轮变为 11 张；375 像素宽度下牌张完整换行，没有页面横向溢出。

`pnpm build` 通过类型检查和生产构建，Worker 作为独立资源打包。浏览器验证完成 AI 定主、扣底、领出、人类跟牌与速度切换；推进到第二轮，控制台无错误或警告。

对战实验入口为 [experiments/optimized.test.ts](../experiments/optimized.test.ts)，数据见 [optimized_vs_fast.json](../experiments/results/optimized_vs_fast.json)。实验固定叫 70 分、固定定主和扣底，种子 50001–50256，共 256 个独立发牌组、512 局交换双方。新搜索每次最多 32 个样本、不限总搜索时间；双方都使用允许的信息。

初步赢副率 **64.65%**，按独立发牌组估计的 95% 区间为 **61.56%–67.74%**。这支持新搜索在该条件下强于快速启发式；没有比较同等计算预算的旧搜索，也未覆盖全部叫分和真实玩家风格。

本机搜索耗时 P50 **5.92 ms**、P95 **73.40 ms**、最大 **202.73 ms**，具体原始值见结果 JSON。该实验未启用牌桌的 250 ms 截止时间，耗时不包含 Worker 启动与消息调度，不能作为移动设备的延迟承诺。256 组属于初步验证，尚未达到设计文档建议的 2000 组最终评估规模。

## 7. 适用边界

首版仅支持 `basic-v1`：12 张手牌、4 张底牌、`basicScoring`，分牌不可扣底。自定义计分规则需增加明确规则标识及对应模拟评价器。

牌局模型是在张数、缺门和底牌限制下均匀分配；尚未用叫分、定主、扣底偏好或历史行为似然建立真实后验。模拟中的其他玩家使用固定快速策略。增加采样次数可以减少统计误差，不能自动消除这些模型误差。
