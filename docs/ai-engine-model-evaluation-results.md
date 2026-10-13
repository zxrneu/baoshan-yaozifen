# AI 引擎与模型评测结果及修复记录

更新日期：2026-10-12。本轮使用套件 **1.2.0**，只重跑离线引擎；真实 LLM 与 Laya 的历史成绩单列。方法与命令见[评估方案](ai-engine-model-evaluation-plan.md)，全部报告及原始日志见[产物索引](../experiments/results/engine-model-eval/README.md)。

本文保留提交`c2819c8`对应的离线修复验证。后续Prompt 2.0已做同配置真实Qwen场景对照，见[提示词优化记录](llm-prompt-optimization.md)；其源码指纹不同，未与本页离线成绩合并排名。

当前套件已升级至 1.4.0 / 55 例，新版覆盖与离线诊断见[覆盖补强说明](evaluation-coverage.md)。本页保留 1.2.0 的历史结果，不与新版合并排名。

## 1. 当前结论

**交互速度和当前固定场景表现优先时，建议使用 Bridge Fast；实战最强引擎仍待更大样本确认；最佳模型尚无同版、同配置的比较证据。** 本轮没有据此修改游戏默认配置。

Bridge Fast 在 35 个场景中通过 29 个，优于本轮两个搜索配置且耗时更低。Deep 的两组实战分别为 12:8、10:10，但赢副率差区间都跨 0；不能据此断言 Deep 最强，也不能用场景分数断言 Fast 实战最强。三个离线配置的叫分和扣底存在相同短板，优先改进共用策略更有直接依据。

`qwen38_27b` 已有真实调用与长尾日志，可继续作为集成基线。新版尚未重测，也没有另一模型的同条件数据，不能宣布最佳模型或最佳思考档位。Laya 亦需按新版场景重新评估。

## 2. 本轮场景成绩

来源：[横向报告](../experiments/results/engine-model-eval/cross-engine-comparison.md)与[结构汇总](../experiments/results/engine-model-eval/cross-engine-summary.json)。环境为 Node.js / darwin arm64；每配置每场景执行一次，三配置共 105 条决策。

| 配置 | 通过数 / 通过率 | 最终合法率 | 阶段宏均分 | 叫分 / 定主 / 扣底 / 出牌 | 调用 P95 |
| --- | --- | --- | --- | --- | --- |
| Bridge Fast | 29/35，82.9% | 100% | 86 | 74 / 90 / 85 / 94 | 0 ms（取整） |
| Bridge Deep | 27/35，77.1% | 100% | 84 | 74 / 90 / 85 / 87 | 250 ms |
| Algorithm Optimized | 27/35，77.1% | 100% | 84 | 74 / 90 / 85 / 88 | 270 ms |

三者前三阶段共用启发式；此处是组合引擎表现。场景通过率衡量固定战术期望，不是赢副率。耗时包含此 CLI 的调用，未测 UI、浏览器 Worker 或产品端到端等待；0 ms 表示毫秒取整。

本轮三份 manifest 使用相同数据与源码指纹，配置指纹各自独立：

```text
suiteVersion: 1.2.0
dataHash: d06d47344f6fc75472e6b348e20683eb068384857eb92493a85e0a36a24a9950
codeHash: b38b64024d7d09bb06062cd2f8e1f5dd9aedc0ae75e66f924fdd6ec2beb29438
```

### 可以直接定位的失误

| 配置 / 场景 ID | 实际动作 | 当前期望 | 优化方向 |
| --- | --- | --- | --- |
| 三者 / `bid-standard-open` | 85 | 70 / 75 | 校准普通起叫，避免过高承诺 |
| 三者 / `bid-extreme-long-suit` | 90 | 70 / 75 | 长套优势不能直接放大叫分 |
| 三者 / `bid-trap-high-points-flat` | 100 | Pass | 分值与控制力分开，防止无套冒进 |
| 三者 / `bid-rebid-raise` | 95 | 80 / 85 | 加入再叫风险与竞争上限 |
| 三者 / `bury-preserve-side-honors` | `KC,3C,4D,2D` | 保留 `KC` | 比较绝门收益与控制张损失 |
| 三者 / `bury-protect-trapped-king` | `KC,4C,6D,2D` | 保留 `4C`、保主 | 检查双张 K 的结构保护 |
| Deep / `play-lead-draw-trumps` | `8S` | `AS` | 日志包含 `node_limit`，检查续打偏差与候选估值 |
| Deep / `play-lead-side-ace` | `QD` | `AH` | 日志包含 `node_limit`，对照精确样本与估计样本 |
| Algorithm / `play-lead-draw-trumps` | `AH` | `AS` | 检查采样和 rollout 对拔主价值的估计 |
| Algorithm / `play-third-hand-high` | `4C` | `QC` / `KC` | 检查第三手争墩与搭档配合 |

从[Fast 日志](../experiments/results/engine-model-eval/cross-bridge-fast-1791786038304/decisions.ndjson)、[Deep 日志](../experiments/results/engine-model-eval/cross-bridge-deep-1791786038313/decisions.ndjson)、[Algorithm 日志](../experiments/results/engine-model-eval/cross-algorithm-optimized-1791786040335/decisions.ndjson)按 `scenarioId` 定位，核对 `inputObservation`、动作、候选及扣分原因。预算截断只能提示估计的不确定性，不能单凭该标记确定失误原因。

## 3. 本轮复式实战

两组均使用起始 seed `20261001`、步长 137，交换东西/南北各打一局；每组比赛 10 个发牌组、20 局，强制叫分干预组为 0。两场比较用了相同种子集合，不能合并成 20 个不同发牌组。

| A vs B | 实际赢副 A:B | A−B 赢副率差 | 95% 组级保守区间 | 可得结论 |
| --- | --- | --- | --- | --- |
| Deep vs Fast | 12:8 | +20.0 个百分点 | [-65.9, 100.0] 个百分点 | 点估计 Deep 领先，证据不足 |
| Deep vs Algorithm | 10:10 | 0.0 个百分点 | [-85.9, 85.9] 个百分点 | 未观察到可靠优势 |

来源：[Deep vs Fast 报告](../experiments/results/engine-model-eval/duplicate-1791786080439-bridge-deep-vs-bridge-fast/report.md)、[Deep vs Algorithm 报告](../experiments/results/engine-model-eval/duplicate-1791786143520-bridge-deep-vs-algorithm-optimized/report.md)。区间按独立发牌组的 Hoeffding 保守界计算；样本少导致区间很宽，不是精确牌力估计。

累计吃分分别为 595:460 和 595:620，仅作辅助诊断。提前结算时未打出分可能很多；吃分领先不一定赢副。新版统计已按规则 `winnerSide` 计算。

## 4. 历史模型与搜索证据

以下结果不参与 1.2.0 排名。保留它们用于服务集成、性能诊断与修复前后追踪。

| 历史运行 | 套件 / 覆盖 | 通过数 | P50 / P95 | 用途与限制 |
| --- | --- | --- | --- | --- |
| [早期离线模拟](../experiments/results/engine-model-eval/run-1791769211455-qwen38_27b/report.md) | 1.0.0 / 21 例 | 11/21 | 0 / 1773 ms | 21 次回退，不能代表真实模型 |
| [早期真实叫分](../experiments/results/engine-model-eval/run-1791774829337-qwen38_27b/report.md) | 1.0.0 / 5 例 | 3/5 | 16190 / 26103 ms | 集成与请求诊断，不是完整能力评估 |
| [Qwen 定主 low](../experiments/results/engine-model-eval/run-1791783103385-qwen38_27b/report.md) | 1.1.0 / 7 例 | 6/7 | 10949 / 33824 ms | 真实调用，需按新版重测 |
| [Qwen 叫分 low](../experiments/results/engine-model-eval/run-1791783763376-qwen38_27b/report.md) | 1.1.0 / 8 例 | 8/8 | 12995 / 308691 ms | 出现超过 5 分钟的长尾 |
| [Qwen 叫分 none](../experiments/results/engine-model-eval/run-1791784116867-qwen38_27b/report.md) | 1.1.0 / 8 例 | 5/8 | 2897 / 4585 ms | 较快但样本少，配置记录不完整 |

最后两组虽记录思考档位与 800000 ms 超时，未保存 `disableBidAdvice` 等完整配置，不能把通过率/速度变化全归因于思考档位。当前新版日志已记录这些字段；下一轮需做同条件、重复的四组消融。

[修复前五引擎报告](../experiments/results/engine-model-eval/history-1791785858859/cross-engine-comparison.md)包含 Qwen 32/35、Laya 18/35。这些成绩来自旧版场景/裁判，保留作历史诊断，不与本轮三引擎表拼接。

另有三类独立实验：

- [优化搜索 vs fast](../experiments/results/optimized_vs_fast.json)：256 组、512 副，优化搜索赢副率 64.65%，95% 区间 61.56%～67.74%。固定叫 70、smartTrump/smartBury、32 世界；对象与协议不同，不能用来证明本轮 Bridge Deep 优于 Fast。
- [搜索核延迟](../experiments/results/ai_latency.json)：384 个观察，default P95 250.059 ms，existing-fast 84.853 ms，proposed-interactive 80.052 ms。只包含 Node 搜索核，不代表产品等待。
- [God-mode 真实 LLM 集成](examples/god-mode-v1-llm-results.json)：单副牌，41 次模型响应、5 次确定性动作、0 回退；模型响应 P95 12.304 秒。用于四阶段接入与日志诊断，不能并入普通视角牌力榜。

## 5. 套件 1.2.0 的修复与验证

| 问题 | 修复后的行为 | 回归依据 |
| --- | --- | --- |
| DDS 截断后把中途得分当成终局 | 复制叶节点并快速续打至锁定胜负；记录精确/深度/节点截断状态 | 截断时 60 分但续打可达 70 的回归 |
| 根候选预算/搜索窗口影响横向估值 | 每候选独立完整窗口，均分节点额度、重置置换表，表项区分深度 | 节点预算与每候选状态检查 |
| 非首家出牌的行动座位错误 | 依据领出家和当前墩长度计算行动者 | 跟牌座位回归 |
| PIMC 混淆实际采样与精确结果 | 逐候选记录实际样本、精确/续打数、搜索停止原因；不虚构唯一候选胜率 | DDS/PIMC 日志核对 |
| 两例历史庄闲得分写反 | 重新计算赢家与所属队伍，修正座位 2 赢墩的得分归属 | 场景守恒与错误队伍拒绝测试 |
| 搭档绝门一例强制唯一出牌 | 同时接受已升高 `KD` 和尝试将吃的 `3C` | 合理替代动作回归 |
| 复式比赛按吃分高低判胜 | 主指标改按 `winnerSide`；干预组排除；按组给区间 | 低吃分但实际赢副、全平组非零宽区间测试 |
| 数据/配置变化复用旧成绩 | 套件、输入/裁判、实际配置、当前源码四项匹配才复用 | 输入、裁判、配置变动缓存回归 |
| 日志观察不全、实际配置不可追溯 | 冻结构造一次；完整可见输入、请求/响应、动作、候选、配置白名单 | 冻结输入与无密钥日志测试 |

修复后已验证：**24 个测试文件、299 项测试通过，TypeScript 检查及生产构建通过**；构建仍有现有的 bundle 大小提示。105 条场景记录的输入与指纹已核对。

按日志实际动作重放过三次离线对战的 **60 局**，赢家与庄闲得分均一致。其中包含一次中间版本的 20 局；最新结论只使用上述两次最终运行的 40 局，不能把 60 局都算作本轮新增统计样本。

## 6. 下一轮优先级

1. 调整共用叫分/扣底策略，先处理四类过高叫分与副牌 K 保护；使用独立牌局检查是否过拟合场景。
2. 同版重测 Qwen 与 Laya，并比较 `low/none × bidAdvice 开/关`；记录真实部署版本、逐请求计数和服务分段耗时。
3. 检查 Deep 的截断候选估值，比较节点预算、采样量与战术先验；用可精确求解残局校准续打偏差。
4. 扩大独立发牌种子、平衡座位/庄家，按区间宽度决定是否足以排序；接入 LLM 普通视角实战后再讨论最佳模型。
