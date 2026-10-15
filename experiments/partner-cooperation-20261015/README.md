# 搭档配合改动效果评测（2026-10-15）

基础启发式在本次受控对照中有提升证据；旧版蒙特卡洛搜索只有小幅正向点估计，尚不能确认增强。产品默认 Bridge Fast 的决策没有变化。本次修正规范型、题面和 CLI 提高了评测可信度，不能把这些工程修复或开发集扩题造成的比例变化当作牌力增长。

## 受控对照结果

基线为提交 `95e7fae` 中的 `src/ai/heuristic.ts` 和 `src/ai/search.ts`；候选为本次工作区版本。每次只对照一个模块，两个版本共用当前规则、采样器、rollout、裁判，以及相同的叫分、定主、扣底策略（Bridge Fast 的公开观察接口）。比较范围为**出牌阶段改动**。

每项固定 512 个独立发牌组，每组同一发牌种子交换东西/南北各打一副；两项合计 **1,024 组、2,048 副完整对局**。以引擎实际 `winnerSide` 计赢副，吃分仅作辅助指标；没有强制叫分、非法动作回退、Mock 或模型请求。

| 出牌策略 | 新版赢副 | 旧版赢副 | 新版胜率 | 新版 − 旧版赢副率差 | 按发牌组计算的 95% 保守区间 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 基础启发式 | 574/1,024 | 450/1,024 | 56.1% | +12.1 个百分点 | [+0.1, +24.1] 个百分点 |
| 旧版搜索，默认预算 | 527/1,024 | 497/1,024 | 51.5% | +2.9 个百分点 | [−9.1, +14.9] 个百分点 |

区间复用 `pairedWinRateInterval` 的 Hoeffding 计算，将整组换边对战作为独立单位，分别报告两项实验，未做多重比较校正。启发式区间下界仅略大于零，属于接近门槛的正向证据；搜索区间包含零。两者均不能外推为对所有对手、叫分配置或生产环境都有优势，也不构成默认引擎替换结论。

搜索固定为每候选 **24 个世界、领出最多 6 个候选、跟牌最多 8 个候选**。通过原有 `independentSearchRandom` 的熵入口，为两版的每个候选提供相同随机世界序列；搜索熵与发牌种子独立。该协议减少比较噪声，生产环境独立随机熵下的波动未另行测量。所有 512 组均纳入统计，未按中途结果停测或调参。

辅助吃分差分别为启发式 **+4,340**、搜索 **+1,415**。本机进程内出牌 P95：启发式旧/新为约 **0.007/0.019 ms**，搜索旧/新约 **11.923/11.908 ms**；搜索运行期间与交付检查有部分重叠，这些耗时仅作诊断，不代表目标设备、Worker 或 UI 的端到端延迟验收。

## 产品默认引擎与同题裁判

另以同一套**修正后的**开发集和保留集，对照 `95e7fae` 与当前的 Bridge Fast。代码内断言全部 105 道题的新旧实际动作和通过结果逐项相同，不能将历史 55 题的比例与扩充后 65 题直接相减。

| 数据集 | 旧版 Bridge Fast | 当前 Bridge Fast | 出牌阶段 | 最终合法率 |
| --- | ---: | ---: | ---: | ---: |
| 开发集 | 64/65（98.5%） | 64/65（98.5%） | 29/30 | 100% |
| 保留集 | 34/40（85.0%） | 34/40（85.0%） | 12/16 | 100% |

默认产品通过 `DecisionEngineManager` 选择 Bridge，默认模式为 Fast；其出牌走 `evaluateBridgeTactics`，没有调用本次修改的旧版 `aiPlay` 或 `searchBestCard`。Algorithm Optimized 同样使用另一套观察搜索实现，本次没有证据表明其策略变强。保留集已用于人工审查和回归，可用于外样诊断，不能再视为未接触的最终盲测集。

当前默认引擎未通过的题目均保留原裁判，不为提高通过率改答案：

- 开发集：`play-second-west-duck-ace`。
- 保留集：`holdout-bid-north-fourth-seat-balance`、`holdout-bury-west-preserve-all-trumps`、`holdout-play-east-lead-cash-side-ace`、`holdout-play-south-second-hand-cover-honor`、`holdout-play-west-lead-trump-exit`、`holdout-play-west-second-hand-fly-ace-capture`。

## 复现与原始证据

在仓库根目录执行；默认基线引用已固定，不依赖执行时的 HEAD：

```bash
pnpm exec tsc --noEmit -p experiments/partner-cooperation-20261015/tsconfig.json
pnpm exec vite-node --mode test experiments/partner-cooperation-20261015/evaluate.ts \
  --baseline-ref 95e7fae --heuristic-boards 512 --search-boards 512 --worlds 24 \
  --output experiments/partner-cooperation-20261015/reproduction
```

脚本仅将旧版两个模块的相对导入重定位到当前依赖，不改策略分支；Bridge Fast 对照也只重定位导入。决策收到的旧式状态以 Proxy 阻止其他暗牌、未知底牌和发牌 seed 读取，100 分合法明牌与本人已知底牌按规则保留。对局引擎逐步校验动作；若发生规则错误、信息越权、超出重发预算或执行失败，保留故障轨迹并中止，不静默排除样本。

- [协议、源码指纹和两个模块的完整新旧源码](confirmed/manifest.json)
- [结果汇总](confirmed/summary.json)
- [启发式全部发牌组与终局结果](confirmed/heuristic-boards.json)
- [搜索全部发牌组与终局结果](confirmed/search-boards.json)
- [全部公开观察及决策原始轨迹，gzip NDJSON](confirmed/decisions.ndjson.gz)
- [当前开发集标准报告](confirmed/control-bridge-fast-dev/report.md)、[旧版同题报告](confirmed/baseline-control-bridge-fast-dev/report.md)
- [当前保留集标准报告](confirmed/control-bridge-fast-holdout/report.md)、[旧版同题报告](confirmed/baseline-control-bridge-fast-holdout/report.md)

各标准报告目录同时保存 `summary.json`、`decisions.ndjson`、`manifest.json`。本次沿用套件 1.4.0，因此必须结合数据/源码指纹识别版本；未覆盖已有的跨引擎或模型实验结果。

工程验证：本轮修复先复现 6 项回归失败，再验证通过；提交前 `pnpm test` 为 **91 文件、1,007 项通过**，`pnpm build` 通过。实验脚本使用独立 TypeScript 配置，并以小规模重跑核对与正式运行的同一前缀发牌组一致。

一轮与构建并行的检查中，既有 HTTP 重试计数用例触发 1 秒决策总预算，实际请求数不足；隔离复跑该用例通过，停止并行构建后的完整 1,007 项测试也通过。未改动该用例的请求计数断言或决策预算。
