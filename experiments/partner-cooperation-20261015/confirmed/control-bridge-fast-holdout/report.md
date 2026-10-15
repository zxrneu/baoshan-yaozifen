# 保山幺子分 · 全阶段决策能力基准评测报告

- **运行 ID**: `control-bridge-fast-holdout`
- **基准套件版本**: `1.4.0`
- **评测引擎**: `bridge`
- **评测数据集**: `holdout`
- **评测时间**: `2026-10-15T12:48:13.638Z`

## 样本覆盖与解释边界

公开开发回归集，不代表泛化牌力；覆盖计数不是抽样权重。单步通过率不能替代独立发牌的换边对战赢副率。

| 阶段/座位 | 东（0） | 南（1） | 西（2） | 北（3） |
| --- | --- | --- | --- | --- |
| bidding | 2 | 2 | 2 | 2 |
| trump | 2 | 2 | 2 | 2 |
| bury | 2 | 2 | 2 | 2 |
| playing | 4 | 4 | 4 | 4 |

- 出牌位置（第 1/2/3/4 手）：4/4/4/4
- 出牌角色（庄家/搭档/闲家）：5/3/8
- 出牌轮次（1–4/5–9/10–12）：16/0/0
- bury 主花色（S/H/C/D）：2/2/2/2
- playing 主花色（S/H/C/D）：16/0/0/0
- trump 合同档：70 分 × 1、75 分 × 5、80 分 × 1、85 分 × 1
- bury 合同档：75 分 × 8
- playing 合同档：75 分 × 15、80 分 × 1
- 距成局线 5 分（庄/闲）：0/0
- 已知底牌：0；100 分明牌（庄家/搭档/闲家）：0/0/0

## 1. 核心指标概览

| 指标 | 结果 | 目标/口径 |
| --- | --- | --- |
| **总场景数** | **40** | 本次所选场景 |
| **标准通过率** | **85.0%** (34/40) | 期望 ≥ 85% |
| **最终合法率** | **100.0%** (40/40) | 红线要求 100% |
| **计划模型调用** | **0** | 需发起调用总数 |
| **实际调用数** | **0** | 实际 HTTP 尝试数（含失败和重试） |
| **实际重试数** | **0** | 同一次请求的额外 HTTP 尝试 |
| **已发起请求的决策数** | **0** | 不重复计算重试 |
| **无动作执行失败** | **0次** | 单列，不计回退 |
| **原生调用成功率** | **N/A (非模型或未调用)** | 原生合法动作 / 已发起请求的决策；排除回退和 Mock |
| **回退率** | **0.0%** (0次) | 目标 0% |
| **阶段宏平均分** | **90** / 100 | 等权四阶段均分 |
| **端到端 P50 耗时** | **0 ms** | 交互体验标准 |
| **端到端 P95 耗时** | **2 ms** | 长尾控制标准 ≤ 2000 ms |

## 2. 四阶段分项对比

| 阶段 | 场景数 | 通过数 | 通过率 | 平均得分 | P50 延迟 | P95 延迟 |
| --- | --- | --- | --- | --- | --- | --- |
| 叫分 (Bidding) | 8 | 7 | 87.5% | 85 | 0 ms | 0 ms |
| 定主 (Trump) | 8 | 8 | 100.0% | 96 | 0 ms | 0 ms |
| 扣底 (Bury) | 8 | 7 | 87.5% | 93 | 1 ms | 2 ms |
| 出牌 (Playing) | 16 | 12 | 75.0% | 85 | 0 ms | 0 ms |

## 3. 40 组场景详细战报明细

| 场景 ID | 阶段 | 分类 | 状态 | 得分 | 耗时 | 实际动作 | 期望最优动作 | 判定依据 |
| --- | --- | --- | :---: | :---: | --- | --- | --- | --- |
| `holdout-bid-east-balanced-strong-open` | bidding | 起叫标准 | ✅ 通过 | 85 | 0ms | `叫 80 分` | 起叫 75 | 正常试探性叫分：叫 80 分 |
| `holdout-bid-east-flat-weak-pass` | bidding | 消极放弃 | ✅ 通过 | 90 | 0ms | `Pass` | 不叫 (Pass) | 合理放弃：手牌牌力不足（HCP: 3, 长套: 3），稳健选择不叫 |
| `holdout-bid-south-extreme-two-suiter` | bidding | 双套强牌 | ✅ 通过 | 95 | 0ms | `叫 80 分` | 起叫 80 | 精准叫分：依托 6 张长套与 16 点控牌积极争庄，叫 80 分契合期望 |
| `holdout-bid-south-compete-over-75` | bidding | 竞争叫分 | ✅ 通过 | 85 | 0ms | `叫 80 分` | 加叫 80 | 正常试探性叫分：叫 80 分 |
| `holdout-bid-west-support-partner-pass` | bidding | 搭档配合 | ✅ 通过 | 90 | 0ms | `Pass` | 不叫 (Pass) | 合理放弃：手牌牌力不足（HCP: 10, 长套: 3），稳健选择不叫 |
| `holdout-bid-west-long-minor-preempt` | bidding | 长套起叫 | ✅ 通过 | 85 | 0ms | `叫 70 分` | 起叫 70 | 正常试探性叫分：叫 70 分 |
| `holdout-bid-north-fourth-seat-balance` | bidding | 平衡叫分 | ❌ 未过 | 60 | 0ms | `Pass` | 起叫 70 | 合理放弃：手牌牌力不足（HCP: 13, 长套: 5），稳健选择不叫；未达成场景最优标准（期望：起叫 70） |
| `holdout-bid-north-heavy-defense-trap` | bidding | 防守纪律 | ✅ 通过 | 90 | 0ms | `Pass` | 不叫 (Pass) | 合理放弃：手牌牌力不足（HCP: 15, 长套: 4），稳健选择不叫 |
| `holdout-trump-east-solid-six-hearts` | trump | 单一长套 | ✅ 通过 | 98 | 0ms | `定主 H` | 定红桃 (H) | 极佳定主：选定最长花色 H (6 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-trump-east-two-equal-suits-quality` | trump | 双套抉择 | ✅ 通过 | 98 | 0ms | `定主 S` | 定黑桃 (S) | 极佳定主：选定最长花色 S (5 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-trump-south-long-minor-diamonds` | trump | 超长套 | ✅ 通过 | 98 | 0ms | `定主 D` | 定方块 (D) | 极佳定主：选定最长花色 D (7 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-trump-south-length-beats-strength` | trump | 长度优先 | ✅ 通过 | 85 | 0ms | `定主 C` | 定草花 (C) | 合理定主：选定最长花色 C (6 张) |
| `holdout-trump-west-five-four-hearts` | trump | 长短对比 | ✅ 通过 | 98 | 0ms | `定主 H` | 定红桃 (H) | 极佳定主：选定最长花色 H (5 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-trump-west-extreme-monosuite` | trump | 独门巨套 | ✅ 通过 | 98 | 0ms | `定主 C` | 定梅花 (C) | 极佳定主：选定最长花色 C (8 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-trump-north-spades-with-void` | trump | 带绝门定主 | ✅ 通过 | 98 | 0ms | `定主 S` | 定黑桃 (S) | 极佳定主：选定最长花色 S (5 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-trump-north-diamonds-power` | trump | 豪华单套 | ✅ 通过 | 98 | 0ms | `定主 D` | 定方块 (D) | 极佳定主：选定最长花色 D (6 张) 且带大牌控制张，控场潜力极佳 |
| `holdout-bury-east-double-void-clubs-diamonds` | bury | 双短门扣空 | ✅ 通过 | 98 | 1ms | `扣底 [7C, 3C, 8D, 4D]` | 扣 3C 7C 4D 8D | 绝佳扣底：成功造成 2 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-bury-east-protect-unsupported-king` | bury | 保护副牌K | ✅ 通过 | 98 | 0ms | `扣底 [9D, 8D, 6D, 2D]` | 扣 2D 6D 8D 9D | 绝佳扣底：成功造成 1 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-bury-south-clear-four-hearts` | bury | 拔除长废牌 | ✅ 通过 | 98 | 1ms | `扣底 [9H, 8H, 6H, 3H]` | 扣 3H 6H 8H 9H | 绝佳扣底：成功造成 1 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-bury-south-keep-tenace-aq` | bury | 保留叉子 | ✅ 通过 | 98 | 2ms | `扣底 [9C, 8C, 7C, 3C]` | 扣 3C 7C 8C 9C | 绝佳扣底：成功造成 1 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-bury-west-preserve-all-trumps` | bury | 保护主牌深度 | ❌ 未过 | 60 | 2ms | `扣底 [3H, 9C, 6C, 3C]` | 扣 4 张副牌杂牌保留全主 | 绝佳扣底：成功造成 1 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力；未达成场景最优标准（期望：扣 4 张副牌杂牌保留全主） |
| `holdout-bury-west-protect-guarded-queens` | bury | 保护将力与控制 | ✅ 通过 | 98 | 1ms | `扣底 [8D, 7D, 6D, 3D]` | 扣 3D 6D 7D 8D | 绝佳扣底：成功造成 1 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-bury-north-void-single-and-triple` | bury | 双花色绝门组合 | ✅ 通过 | 98 | 1ms | `扣底 [3S, 9C, 7C, 4C]` | 扣 3S 4C 7C 9C | 绝佳扣底：成功造成 2 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-bury-north-eliminate-middle-suit` | bury | 拔除中门杂牌 | ✅ 通过 | 98 | 1ms | `扣底 [8H, 6H, 4H, 2H]` | 扣 2H 4H 6H 8H | 绝佳扣底：成功造成 1 门副牌绝门，且完整保留所有主牌，具备极高主牌毙杀吃分潜力 |
| `holdout-play-east-lead-cash-side-ace` | playing | 领出拔分 | ❌ 未过 | 60 | 0ms | `出牌 KS` | 出 ♦A (AD) | 常规领出：打出 ♠K；未达成场景最优标准（期望：出 ♦A (AD)） |
| `holdout-play-east-second-hand-split-honors` | playing | 第二手走小 | ✅ 通过 | 92 | 0ms | `出牌 4H` | 出 4H | 积极夺权：打出 ♥4 反超对手拿下本轮 |
| `holdout-play-east-third-hand-finesse-queen` | playing | 第三手争大 | ✅ 通过 | 92 | 0ms | `出牌 QD` | 出 QD | 积极夺权：打出 ♦Q 反超对手拿下本轮 |
| `holdout-play-east-fourth-hand-duck-safe` | playing | 防守垫牌 | ✅ 通过 | 90 | 0ms | `出牌 2S` | 出 2S | 合理隐忍防守：对手已稳拿赢面，出小牌 ♠2 防送分与防浪费 |
| `holdout-play-south-lead-cash-queen-master` | playing | 兑现大牌 | ✅ 通过 | 88 | 0ms | `出牌 QS` | 出 ♠Q (QS) | 常规领出：打出 ♠Q |
| `holdout-play-south-second-hand-cover-honor` | playing | 第二手盖大 | ❌ 未过 | 60 | 0ms | `出牌 2D` | 出 KD | 合理隐忍防守：对手已稳拿赢面，出小牌 ♦2 防送分与防浪费；未达成场景最优标准（期望：出 KD） |
| `holdout-play-south-third-hand-guaranteed-feed` | playing | 搭档稳赢喂分 | ✅ 通过 | 98 | 0ms | `出牌 10S` | 出 10S | 高明配合：搭档已确定稳赢，果断喂出分牌 ♠10 (+10分) 锁定团队得分 |
| `holdout-play-south-fourth-hand-ruff-high-threat` | playing | 绝门毙杀 | ✅ 通过 | 98 | 0ms | `出牌 3S` | 出 3S | 果断毙杀/夺权：打出 ♠3 成功反超对手，截获桌面 15 分大分！ |
| `holdout-play-west-lead-trump-exit` | playing | 安全脱手 | ❌ 未过 | 60 | 0ms | `出牌 2D` | 出 3S | 常规领出：打出 ♦2；未达成场景最优标准（期望：出 3S） |
| `holdout-play-west-second-hand-fly-ace-capture` | playing | 飞A抓大牌 | ❌ 未过 | 60 | 0ms | `出牌 3D` | 出 AD | 合理隐忍防守：对手已稳拿赢面，出小牌 ♦3 防送分与防浪费；未达成场景最优标准（期望：出 AD） |
| `holdout-play-west-third-hand-partner-winning-preserve` | playing | 保大牌控制 | ✅ 通过 | 92 | 0ms | `出牌 2H` | 出 2H | 稳健赢墩：打出 ♥2 拿下本轮 |
| `holdout-play-west-fourth-hand-discard-garbage` | playing | 将吃抢分 | ✅ 通过 | 92 | 0ms | `出牌 7S` | 用主牌将吃，优先7S | 积极夺权：打出 ♠7 反超对手拿下本轮 |
| `holdout-play-north-lead-attack-short-suit` | playing | 兑现赢张 | ✅ 通过 | 98 | 0ms | `出牌 AH` | 出 AH 或 AC 兑现10分 | 坚强赢张兑现：首攻打出副牌顶张 ♥A，稳拿赢墩并拔分 |
| `holdout-play-north-second-hand-duck-tenace` | playing | 飞张放小 | ✅ 通过 | 90 | 0ms | `出牌 2H` | 出 2H | 合理隐忍防守：对手已稳拿赢面，出小牌 ♥2 防送分与防浪费 |
| `holdout-play-north-third-hand-force-ace` | playing | 逼出敌方大牌 | ✅ 通过 | 92 | 0ms | `出牌 KD` | 出 KD | 稳健赢墩：打出 ♦K 拿下本轮 |
| `holdout-play-north-fourth-hand-overruff` | playing | 大主超毙 | ✅ 通过 | 98 | 0ms | `出牌 QS` | 出 QS | 果断毙杀/夺权：打出 ♠Q 成功反超对手，截获桌面 15 分大分！ |
