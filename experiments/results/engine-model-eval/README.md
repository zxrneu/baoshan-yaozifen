# AI 评测产物索引

整理日期：2026-10-14。新版套件诊断见[1.4.0 固定产物](coverage-v14-1791875352353/README.md)及[覆盖说明](../../../docs/ai/evaluation-coverage.md)；Prompt 对照见下节。阅读历史修复结论请先看[结果与修复记录](../../../docs/ai/evaluation-results.md)，运行协议与命令见[评估方案](../../../docs/ai/evaluation-plan.md)。

根目录的横向/对战报告是最近一次输出，未来运行会更新；下表的独立 run 目录是本次结论的固定依据。`history-*` 是更新前根报告的副本，不能自动视为有效新数据。

## Prompt 2.0专项结果

[真实Qwen对照与原始日志](prompt-v2-20261012/README.md)：原提示词22/35，新版26/35；none档、每场景一次，改善8例、回退4例。此处不与下方离线成绩合并排序。

## 套件 1.4.0 Qwen 跨 run 诊断

[合并诊断报告](qwen-v14-full-suite-merged.md)保留首轮与出牌重跑的部分合并结果；[首轮固定报告](run-1791893694714-qwen38_27b/report.md)与[出牌重跑报告](run-1791899019105-qwen38_27b/report.md)各自含 manifest 和完整日志。两次 codeHash/dataHash 不同，原失败继续保留；该合并不作为同指纹完整基线，也不与离线诊断合并排名。

## 离线修复验证（提交c2819c8，套件1.2.0）

- [三引擎固定横向报告](history-1791869169872/cross-engine-comparison.md)、[固定 JSON 汇总](history-1791869169872/cross-engine-summary.json)：每引擎 35 场景，共 105 条决策。
- [Deep vs Fast 固定报告](duplicate-1791786080439-bridge-deep-vs-bridge-fast/report.md)：10 组 20 局，实际赢副 12:8。
- [Deep vs Algorithm 固定报告](duplicate-1791786143520-bridge-deep-vs-algorithm-optimized/report.md)：10 组 20 局，实际赢副 10:10。

| 固定运行目录 | 报告 | 配置与指纹 | 原始日志 |
| --- | --- | --- | --- |
| `cross-bridge-fast-1791786038304` | [报告](cross-bridge-fast-1791786038304/report.md) / [指标](cross-bridge-fast-1791786038304/summary.json) | [manifest](cross-bridge-fast-1791786038304/manifest.json) | [35 条决策](cross-bridge-fast-1791786038304/decisions.ndjson) |
| `cross-bridge-deep-1791786038313` | [报告](cross-bridge-deep-1791786038313/report.md) / [指标](cross-bridge-deep-1791786038313/summary.json) | [manifest](cross-bridge-deep-1791786038313/manifest.json) | [35 条决策](cross-bridge-deep-1791786038313/decisions.ndjson) |
| `cross-algorithm-optimized-1791786040335` | [报告](cross-algorithm-optimized-1791786040335/report.md) / [指标](cross-algorithm-optimized-1791786040335/summary.json) | [manifest](cross-algorithm-optimized-1791786040335/manifest.json) | [35 条决策](cross-algorithm-optimized-1791786040335/decisions.ndjson) |
| `duplicate-1791786080439-bridge-deep-vs-bridge-fast` | [报告](duplicate-1791786080439-bridge-deep-vs-bridge-fast/report.md) | [manifest](duplicate-1791786080439-bridge-deep-vs-bridge-fast/manifest.json) | [10 组双局日志](duplicate-1791786080439-bridge-deep-vs-bridge-fast/boards.ndjson) |
| `duplicate-1791786143520-bridge-deep-vs-algorithm-optimized` | [报告](duplicate-1791786143520-bridge-deep-vs-algorithm-optimized/report.md) | [manifest](duplicate-1791786143520-bridge-deep-vs-algorithm-optimized/manifest.json) | [10 组双局日志](duplicate-1791786143520-bridge-deep-vs-algorithm-optimized/boards.ndjson) |

场景三份 manifest 的 `dataHash` 和 `codeHash` 一致；两份最终对战使用同一 `codeHash`。通过率与实战赢副率不可混用，十组对战的区间仍不足以确认牌力排序。

## 中间运行与报告归档

| 路径 | 内容 | 使用边界 |
| --- | --- | --- |
| [cross-bridge-fast-1791785855442](cross-bridge-fast-1791785855442/report.md) | Fast 中间场景结果 | 源码指纹与最终运行不同 |
| [cross-bridge-deep-1791785855458](cross-bridge-deep-1791785855458/report.md) | Deep 中间场景结果 | 不并入最终场景统计 |
| [cross-algorithm-optimized-1791785857504](cross-algorithm-optimized-1791785857504/report.md) | Algorithm 中间场景结果 | 不并入最终场景统计 |
| [duplicate-1791785895322-bridge-deep-vs-bridge-fast](duplicate-1791785895322-bridge-deep-vs-bridge-fast/report.md) | 中间对战 11:9，另 20 局 | 已用于动作重放验证，不追加到最终牌力统计 |
| [history-1791785858859](history-1791785858859/cross-engine-comparison.md) | 修复前五引擎场景比较 | 含旧 Qwen / Laya 成绩，不参与新版排序 |
| [history-1791785918499](history-1791785918499/duplicate-battle-bridge-deep-vs-bridge-fast.md) | 修复前 Deep vs Fast 对战 | 使用旧吃分判胜口径，不作实际赢副证据 |
| [history-1791786042152](history-1791786042152/cross-engine-comparison.md) | 中间三引擎场景汇总 | 查看修复过程 |
| [history-1791786103793](history-1791786103793/duplicate-battle-bridge-deep-vs-bridge-fast.md) | 中间 Deep vs Fast 报告副本 | 对应上面的中间运行，不能重复计数 |
| [history-1791786175543](history-1791786175543/duplicate-battle-bridge-deep-vs-algorithm-optimized.md) | 修复前 Deep vs Algorithm 对战 | 使用旧吃分判胜口径，不作实际赢副证据 |

## 历史 Qwen 运行

各目录有 `manifest.json`、`summary.json`、`report.md`、`decisions.ndjson`。均早于套件 1.2.0，不能与本轮离线表合并排名。

| 运行 | 内容 |
| --- | --- |
| [run-1791769211455-qwen38_27b](run-1791769211455-qwen38_27b/report.md) | 1.0.0，21 场景、全部回退，开发模拟诊断 |
| [run-1791774829337-qwen38_27b](run-1791774829337-qwen38_27b/report.md) | 1.0.0，5 个真实叫分场景 |
| [run-1791783103385-qwen38_27b](run-1791783103385-qwen38_27b/report.md) | 1.1.0，7 个定主场景、low |
| [run-1791783763376-qwen38_27b](run-1791783763376-qwen38_27b/report.md) | 1.1.0，8 个叫分场景、low，含长尾响应 |
| [run-1791784116867-qwen38_27b](run-1791784116867-qwen38_27b/report.md) | 1.1.0，8 个叫分场景、none |

low/none 两组缺少完整专家建议配置记录，不能视为受控消融。旧 manifest 可能缺指纹或用版本号代替哈希；新缓存校验会排除它们。

## 查日志的方法

场景失误先按 `scenarioId` 查 `decisions.ndjson`，核对 `inputObservation`、`candidates`、`actionTaken`、`details`，再看 `rawResponse` 中的请求、原文、候选估值和停止原因。字段按当时引擎与记录版本可能缺失。

对战每条 `boards.ndjson` 记录一个发牌组、两局及各局全部观察/动作。核对 seed、叫分、庄家、`winnerSide`、未打分和 `forcedContract`；重放使用保存的动作，避免重新采样导致轨迹变化。seed 仅供评测重放，不传给决策模型。

配置记录不包含认证密钥；普通视角观察不包含其他座位暗牌。报告副本与原 run 是同一证据，不重复汇总样本。
