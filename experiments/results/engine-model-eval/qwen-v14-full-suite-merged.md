# 套件 1.4.0 · 真实 Qwen (qwen38_27b) 全阶段评测结果

生成方式：`run-1791893694714` 全 55 题首轮，其中受服务中断污染的 8 题（6 次 Connection error + 2 次超时）由 `run-1791899019105`（出牌阶段全 26 题、0 回退、原生 100%）按 scenarioId 替换。两次运行均为套装 1.4.0、思考档位 low、并发 1、超时 1200000 ms、启用叫分启发建议。

> 注意：替换运行发生在 `src/ai/eval/benchmarkRunner.ts` 等文件被并行修改之后，其 codeHash/dataHash 与首轮及离线基线不同（dataHash 变化源于新增 `attributionProtocolVersion`）。本题为单步场景通过率，不代表泛化牌力或实战赢副率。

| 阶段 | 通过 | 均分 | P50 | P95 |
| --- | :---: | :---: | --- | --- |
| 叫分 | 8/10 | 84 | 18898 ms | 41824 ms |
| 定主 | 7/9 | 82 | 12114 ms | 61620 ms |
| 扣底 | 9/10 | 93 | 33827 ms | 89108 ms |
| 出牌 | 25/26 | 93 | 19705 ms | 89425 ms |
| **合计** | **49/55（89.1%）** | **88** | **19705 ms** | **89108 ms** |

最终合法率 55/55，原生调用成功 55/55，回退 0。

## 未通过的 6 题（全部为真实模型决策，STRATEGY_MISS）

| 场景 | 阶段 | 实际 | 期望 |
| --- | --- | --- | --- |
| `bid-extreme-long-suit` | bidding | 叫 80 分 | 叫 70 分 (起叫做庄) |
| `bid-rebid-raise` | bidding | Pass | 叫 80 或 85 分 |
| `trump-trap-points-vs-length` | trump | 定主 H | 定梅花 (C) (绝不定红桃 H) |
| `trump-extreme-7card-dominance` | trump | 定主 S | 定方块 (D) |
| `bury-create-single-void` | bury | 扣底 [3D, 2D, 6S, 7S] | 扣除 ♦3, ♦2 及另两张副牌杂小牌，达成方块绝门 |
| `play-third-east-secure-points` | playing | 出牌 QC | 跟 AC |

## 同套装离线三引擎对照（coverage-v14-1791875352353，旧 codeHash）

| 配置 | 通过 | 叫分/定主/扣底/出牌 |
| --- | :---: | --- |
| qwen38_27b (LLM) | 49/55 (89.1%) | 8/10 · 7/9 · 9/10 · 25/26 |
| bridge-fast | 46/55 (83.6%) | 5/10 · 9/9 · 7/10 · 25/26 |
| algorithm-optimized | 43/55 (78.2%) | 5/10 · 9/9 · 7/10 · 22/26 |
| bridge-deep | 41/55 (74.5%) | 5/10 · 9/9 · 7/10 · 20/26 |

LLM 与离线引擎的 codeHash 不同，且各引擎前三阶段策略不同源，只能作分栏对照，不能称为同条件排名。
