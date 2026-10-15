# 优化出牌 AI：实现与 SOLID 设计

> 文档类型：Algorithm 搜索实现；内容复核：2026-10-16，返回[文档索引](../README.md)。

该内核现由 Algorithm 引擎使用，浏览器默认选择器通过 Web Worker 运行；叫分、定主、扣底共用观察启发式。当前应用旧默认类型为 Bridge，实际四座配置由设置与 profile 决定，见[决策架构](../architecture/decision-engines.md)。本文描述搜索模块，不把最初接入状态当作当前默认配置。

算法依据见[设计文档](../design/optimized-ai.md)，规则推导与搭档超车反例见[策略分析](optimal-play-strategy.md)。新算法在可见信息与明确模型内优化赢副概率，不声称已经求得四人暗牌博弈的均衡最优策略。

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

实际规则函数与简单数据类型直接复用；没有为每个工具函数增加抽象层。默认实现的组合集中在 [index.ts](../../packages/ai-core/src/optimized/index.ts) 和 [browserAgent.ts](../../packages/ai-core/src/browserAgent.ts)。

## 3. 文件与职责

搜索内核位于 `packages/ai-core/src/optimized/`；观察契约与投影由 `packages/game-view/src/` 提供。

| 文件 | 职责 |
| --- | --- |
| `contracts.ts` | 观察、策略、样本、评价、预算与解释结果的小接口。 |
| `packages/game-view/src/observation.ts` | 真实状态投影、缺门、观察合法牌和完整信息键。 |
| `belief.ts` | 容量 DP、合法完成数量、均匀采样及受限枚举。 |
| `computation.ts` | 独立随机源、大整数拒绝采样、截止时间与错误类型。 |
| `policy.ts` | 确定性快速后续策略，启发式仅排序合法牌。 |
| `simulator.ts` | 轻量状态、合法走牌、分数与获胜线、逐步观察投影。 |
| `statistics.ts` | 候选与配对计数、统计副本、联合差异区间。 |
| `pairedSearch.ts` | 全候选搜索、检查点提交、淘汰与预算控制。 |
| `endgame.ts` | 在有限均匀信念状态中优化根玩家的后续行动。 |
| `workerProtocol.ts` | 可序列化消息与最小 Worker 接口。 |
| `worker.ts`、`workerClient.ts` | Worker 入口及取消、消息校验、释放、兜底。 |

[optimizedAgent.ts](../../packages/ai-core/src/optimizedAgent.ts) 负责阶段分派和动作包装；[useGame.ts](../../apps/web/src/hooks/useGame.ts) 负责异步驱动、动画等待和过期状态保护。

## 4. 使用与扩展

脚本可使用同步 Agent，动作仍交给正式引擎校验：

```ts
import { applyAiAction, createOptimizedAgent } from '@yaozifen/ai-core';
import { FAST_OPTIMIZED_BUDGET } from '@yaozifen/ai-core/optimized/index';

const agent = createOptimizedAgent({ budget: FAST_OPTIMIZED_BUDGET });
const action = agent.nextAction(state);
if (action) state = applyAiAction(state, action);
```

需要核查搜索依据时直接使用选牌器：

```ts
import {
  createOptimizedSelector, seededSearchRandom,
} from '@yaozifen/ai-core/optimized/index';
import { observePlayer } from '@yaozifen/game-view/observation';

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

## 6. 验证入口

常规回归覆盖观察隔离、DP 计数与守恒、固定随机源、明牌、小残局、预算截断、Worker 取消及降级，见 `tests/optimized.test.ts`、`tests/open-hand.test.ts` 与 `tests/engine-fairness-isolation.test.ts`。

耗时和策略实验可使用 [experiments/optimized.test.ts](../../experiments/optimized.test.ts)，输出默认忽略。性能和牌力必须在目标配置下重新测量，比较协议见[统一评测](evaluation-plan.md)；不从旧结果推导当前优势。

## 7. 适用边界

首版仅支持 `basic-v1`：12 张手牌、4 张底牌、`basicScoring`，分牌不可扣底。自定义计分规则需增加明确规则标识及对应模拟评价器。

牌局模型是在张数、缺门和底牌限制下均匀分配；尚未用叫分、定主、扣底偏好或历史行为似然建立真实后验。模拟中的其他玩家使用固定快速策略。增加采样次数可以减少统计误差，不能自动消除这些模型误差。
