# 全阶段 AI 引擎与模型评估方案

更新日期：2026-10-12；当前场景套件：**1.2.0**。方案从 `llm_eval_scenarios_plan.md` 的 21 个场景扩充至 35 个，已实现统一执行器、模型入口、复式对战及可追溯日志。

[最新结果与选型结论](ai-engine-model-evaluation-results.md)记录本轮实测与限制；[评测产物索引](../experiments/results/engine-model-eval/README.md)提供报告和原始日志。本文描述方法、可运行命令和待补能力，不维护第二份成绩榜。

## 1. 目标与评估分层

需要分别回答：动作是否合法、战术是否合理、整局是否赢牌、服务是否可靠、等待时间是否可接受。单步场景成绩用于定位问题，不能替代实战赢副率；自然语言解释用于诊断，不按篇幅评分。

| 层次 | 检查内容 | 当前入口 |
| --- | --- | --- |
| L0 数据与契约 | 牌张守恒、座位/轮次/得分、合法候选、观察隔离 | 场景构造器和回归测试 |
| L1 固定场景 | 叫分 8、定主 7、扣底 8、出牌 12，共 35 例 | `eval:engines`、`eval:llm` |
| L2 配对实战 | 同种子交换双方，从叫分至实际结算 | `scripts/match-battle.ts` |
| L3 服务与产品 | 网络、取消、降级、Worker、UI 等待、成本 | 已有生命周期测试与日志；完整端到端测量待补 |

公开场景用于开发回归。确认牌力需另用未参与调参的发牌种子和保留场景，避免仅优化到这 35 题。

## 2. 比较对象与公平性

| 配置 ID | 能力来源与当前配置 | 比较时需注意 |
| --- | --- | --- |
| `bridge-fast` | 前三阶段启发式；出牌专家战术；不采样 | 离线速度与战术基线 |
| `bridge-deep` | 前三阶段同上；DDS/PIMC，16～32 世界、250 ms、残局阈值 6 | 截断后的续打是估计，须看搜索状态 |
| `algorithm-optimized` | 前三阶段共用启发式；优化采样搜索，8～64 世界、250 ms | CLI 直接运行搜索，未计浏览器 Worker 开销 |
| `laya` | 叫分、定主、出牌调用服务；扣底使用启发式 | 扣底成绩属于组合策略；服务失败回退单列 |
| `llm` | 经 LlmEngine 接入部署模型，四阶段支持模型决策 | 唯一候选可能直接返回；Mock、回退不能代表模型牌力 |

Bridge 与 Algorithm 的前三阶段共用策略，成绩接近不是两套独立策略的互相验证。模型比较须固定输入、提示词、协议、格式、超时、并发与服务环境；实际版本、量化、服务版本需额外记录，不能从 `qwen38_27b` 等部署别名推断。

默认叫分提示词带 `bidAdvice`。比较 `low/none × 保留/移除建议` 时，四组分别运行相同样本并重复测量。当前脚本每次每场景执行一次；重复实验需重新运行命令并汇总独立 run，尚无 `--repeat` 参数。

## 3. 场景规格与裁判

完整牌张、局面和判定函数以 [scenarios.ts](../src/ai/eval/scenarios.ts) 的 `setup`、`expectedCriteria` 为准。下表列的是当前通过条件；这些固定局面的经验判定不等于一般局面的最优动作证明。手牌分值/HCP 应从牌张计算，部分历史描述的手工数字不能作为裁判依据。

### 3.1 叫分：8 例

所有通过条件都要求动作合法。100 分会触发搭档明牌，允许该档并不代表实际对战应优先叫 100。

| ID | 局面重点 | 当前接受动作 |
| --- | --- | --- |
| `bid-garbage-pass` | 无控制张、无长套的弱牌 | Pass |
| `bid-standard-open` | 5 张套带 AK，标准起叫 | 70 / 75 |
| `bid-extreme-long-suit` | 7 张长套及短门潜力 | 70 / 75 |
| `bid-strong-high-bid` | 强长套及多门 A | 合法的 85 / 90 / 95 / 100 |
| `bid-competitive-pass` | 已叫 85，中等手牌不追至 90 | Pass |
| `bid-trap-high-points-flat` | 四张 10 加四张 5，共 60 分，但无长套/控制 | Pass |
| `bid-defensive-pass` | 均匀牌型，副牌大牌适合防守 | Pass |
| `bid-rebid-raise` | 首叫 70 后被抬至 75，六张强套再叫 | 80 / 85 |

### 3.2 定主：7 例

| ID | 局面重点 | 当前接受动作 |
| --- | --- | --- |
| `trump-clear-longest` | 黑桃明显最长 | S |
| `trump-equal-length-controls` | 红心/方块各 5 张，比较控制力 | H |
| `trump-trap-points-vs-length` | 红心两张高分对梅花六张长套 | C |
| `trump-extreme-7card-dominance` | 方块七张对黑桃三张大牌 | D |
| `trump-protect-naked-honors` | 黑桃/梅花各五张，避免短门分牌定主 | S |
| `trump-4-4-choice-void-threat` | 黑桃/红心各四张，副牌单张可扣空 | S / H |
| `trump-solid-vs-fragile-length` | 黑桃 AKQJ10 对红心六张小牌 | S |

### 3.3 扣底：8 例

共同合法性要求：扣恰好四张不同的本人非分牌。组合顺序不影响判定；保主是战术条件，不是规则禁止扣主。

| ID | 局面重点 | 当前额外通过条件 |
| --- | --- | --- |
| `bury-zero-point-redline` | 分牌禁止扣底 | 无额外战术条件 |
| `bury-create-single-void` | 扣空方块双张 | 扣 `3D,2D` 且保留全部主牌 |
| `bury-preserve-trumps` | 保持七张主牌深度 | 保留全部主牌 |
| `bury-preserve-side-honors` | 副牌控制张保护 | 不扣 `KC` |
| `bury-double-voids` | 制造两门绝门 | 扣后至少两门绝门 |
| `bury-protect-trapped-king` | 避免只扣梅花小牌 | 不扣 `4C` 且保留全部主牌 |
| `bury-clear-long-garbage` | 整门清除方块废牌 | 扣 `9D,8D,6D,2D` 且保留全部主牌 |
| `bury-keep-tenace` | 保留红心叉子及垫张 | 不扣 `QH,3H` 且保留全部主牌 |

部分判定比场景意图宽：保护 K 的一例未单独禁止扣 `KC`；保留叉子的一例未强制扣四张方块。后续收紧裁判须升级套件并重跑，不能把旧通过率解释为已完整验证这些战术。

### 3.4 出牌：12 例

| ID | 局面重点 | 当前接受动作 |
| --- | --- | --- |
| `play-lead-draw-trumps` | 庄家首轮拔主 | `AS` |
| `play-lead-side-ace` | 历史已清主后兑现副牌 A | `AH` |
| `play-follow-feed-points` | 第四手，搭档 A 确定赢墩 | `10D` / `5D` |
| `play-follow-preserve-honors` | 第四手，搭档 A 赢墩时保 K | `2C` |
| `play-follow-duck-opponent` | 对手 A 赢墩，避免送分 | `3S` |
| `play-slough-ruff-for-points` | 第四手用小主赢含 20 分的墩 | `2S` / `3S` |
| `play-slough-feed-side-points` | 搭档大主稳赢，跨花色垫分 | `10D` |
| `play-overruff-opponent` | 超毙对手小主 | `10S` / `8S` |
| `play-second-hand-low` | 第二手先走小 | `2D` |
| `play-third-hand-high` | 第三手争大 | `QC` / `KC` |
| `play-feed-partner-void` | 搭档梅花绝门，方块 K 已升高 | `KD` / `3C` |
| `play-safe-exit` | 安全脱手，避免领出危险分牌 | 任意合法候选，除 `10D` |

“当前领先”不等于“稳赢”。喂分样例需证明后手不能超车；搭档梅花绝门不证明仍有主牌，因此不能把 `3C` 设为唯一答案。[llmEvaluator.ts](../src/ai/engines/llm/llmEvaluator.ts) 已依据当前实际赢家及稳赢信息评分，再由场景条件判断通过。

### 3.5 数据构造与可见性

[deckHelper.ts](../src/ai/eval/deckHelper.ts) 校验牌张守恒、手牌数量、出牌顺序、领出家连续性、每墩真实赢家、庄闲得分，以及绝门信息与手牌/历史是否矛盾。扣底阶段庄家 16 张；后半局手牌数根据历史扣减，不能仍要求每家 12 张。

完整牌局只供构造与裁判使用。引擎接收 [decisionObservation.ts](../src/ai/decisionObservation.ts) 投影出的可见信息，不传发牌 seed、其他人的暗牌或暗底。100 分搭档明牌按规则公开；God-mode 集成记录单列，不并入普通玩家视角榜单。

## 4. 实验协议与指标

### 场景实验

先区分非法动作与合法但未达战术期望的动作。未通过期望的合法动作最多计 60 分，并降为次优。报告输出通过率、最终合法率、各阶段均分、阶段等权宏平均、P50/P95、回退/Mock 数与决策归因。

宏平均按本次覆盖阶段等权；全阶段样本量为 8/7/8/12。阶段过滤的运行不可与全阶段总分直接比较。延迟是执行器调用耗时，取整为毫秒；P95 使用排序后 `floor(0.95 × n)` 下标（上限为末项）。记录 0 ms 表示四舍五入，不表示没有耗时，也不包含 UI 与所有服务链路。

当前归因分 `model`、`search/heuristic`、`fallback`、`mock`。模型覆盖/调用次数仍按引擎阶段与返回标记推断，唯一候选、重试等缺少请求级计数，不能将原生成功字段当作精确 HTTP 成功率或成本依据。更细的确定性分支、原生非法率和回退链统计属于待补能力。

### 复式实战

每个种子交换东西/南北各打一局，从叫分运行到终局；种子按起点加 `137 × 组号` 递增。主指标按规则结算的 `winnerSide` 计算实际赢副，累计吃分只作辅助指标。提前锁定胜负后保留未打出分，不能按桌面累计吃分多少判断赢家。

以发牌组为独立样本，令每组差值 `x = (A 赢副数 − B 赢副数) / 2`，范围 [-1,1]。当前 95% Hoeffding 保守区间为 `mean(x) ± sqrt(2 × ln(40) / n)`，截取到 [-1,1]。即使所有组都是 1:1，也不能给出零宽区间。该区间依赖独立发牌组假设；固定十组是回归检查，不能据此宣布显著优势。

全 Pass 重发超过三次后强制叫 70 的组会标记并排除主指标。发牌随机源与引擎采样分离；时间预算和随机采样使同种子重新运行未必产生同样决策。日志重放按记录的实际动作验证终局，不要求重新调用引擎得到相同动作。

当前对战入口支持 `bridge-fast`、`bridge-deep`、`algorithm-optimized`、`laya`；尚未接入 LLM 对战。固定前置阶段的旧搜索实验是另一种协议，不能与全生命周期比赛合并统计。

### 选型规则

分开评价牌力、交互速度、离线可用性和模型可靠性。区间跨 0 时写“尚无可靠优势”；模型未在同版数据下比较时写“最佳模型待测”。生产端到端 P95、成本、服务故障率尚无完整测量，不能用离线单步数据代替。

## 5. 版本、缓存与关键日志

[fingerprint.ts](../src/ai/eval/fingerprint.ts) 与 [eval-artifacts.ts](../scripts/eval-artifacts.ts) 形成运行指纹：

| 字段 | 内容 | 用途 |
| --- | --- | --- |
| `suiteVersion` | 当前 1.2.0 | 标记裁判/数据协议版本 |
| `dataHash` | 场景输入、候选、描述及判定函数的 SHA-256 | 识别场景或期望变化 |
| `configHash` | 实际配置白名单、并发、裁判及源码哈希 | 识别引擎/提示词/预算变化 |
| `codeHash` | 当前 `src`/`scripts` TS/TSX、package.json、锁文件内容 | 包含未提交修改，不只看 Git HEAD |

只有四项全部一致才复用横向成绩；旧根目录报告写入 `history-*` 后再更新。各次运行保存在独立目录。文档编辑不改变当前源码指纹。

| 产物 / 字段 | 排查用途 |
| --- | --- |
| `manifest.json`、配置快照、指纹 | 确认使用哪版数据、代码、思考档位、超时、并发及 `disableBidAdvice` |
| `decisions.ndjson` 的 `scenarioId`、`inputObservation`、`candidates` | 找到失败样例与完整可见手牌/历史，排查输入和候选 |
| `rawResponse` 的动作、`rawText`、`requestPayload` | 比对实际请求、原始响应、解析动作与解释；按引擎可用性保存 |
| `candidateEvaluations`、`worldsEvaluated`、`searchStatusCounts` | 查看候选样本与 `exact/depth_limit/node_limit`；区分精确求解与续打估计 |
| `passed/isLegal/score/details/errorCode/fallbackReason` | 区分数据、协议、非法动作、战术失误与服务回退 |
| `boards.ndjson` 的两局观察/决策、庄家、叫分、赢家、未打分、重发与干预标记 | 重放关键动作、核对规则结算与组级统计 |

模型真实版本/量化、服务请求 ID、token usage、首 token/排队/解码时间、Worker 和 UI 分段耗时仍需额外采集；缺失不能填成 0。现有内存 logger 有容量上限，评测另写 NDJSON 保存完整运行。

配置导出使用白名单；API Key、Authorization、Cookie 不进入产物。全量重放材料不回灌到其他座位的模型输入。

## 6. 可运行命令

在项目根目录执行。脚本读取 `.env`；密钥通过环境配置提供，避免写在命令行。

```bash
# 本地验证
pnpm typecheck
pnpm test
pnpm build

# 离线三引擎：35 场景，每次每场景一次
pnpm eval:engines --engine offline --concurrency 1
# 单引擎/阶段；阶段：bidding、trump、bury、playing
pnpm eval:engines --engine bridge-deep --phase playing --concurrency 1
# 全部五种配置：需要 Laya、LLM 服务；强制重新调用 LLM
pnpm eval:engines --concurrency 1 --fresh-llm

# 真实模型：同环境下分别比较思考档位与专家建议
pnpm eval:llm --model qwen38_27b --phase bidding --reasoning low --format json_object --concurrency 1
pnpm eval:llm --model qwen38_27b --phase bidding --reasoning none --format json_object --concurrency 1 --disable-bid-advice

# 全生命周期配对实战：10 组 = 20 局
pnpm exec vite-node scripts/match-battle.ts --engine-a bridge-deep --engine-b bridge-fast --boards 10 --seed 20261001
pnpm exec vite-node scripts/match-battle.ts --engine-a bridge-deep --engine-b algorithm-optimized --boards 10 --seed 20261001
```

`eval:engines` 使用单数 `--engine`，未指定时跑全部配置；支持 `offline`、配置 ID 或子串筛选。`--fresh-llm` 仅控制兼容缓存中的 LLM 是否重用。`eval:llm` 另支持 `--url`、`--timeout`、`--output`；`--mock` 只用于开发诊断，不能作为真实模型榜单。

## 7. 实现状态与后续工作

| 内容 | 状态 |
| --- | --- |
| 35 场景、可见观察、合法性与历史得分校验 | 已实现并有回归测试 |
| 场景执行器、阶段统计、配置指纹、独立日志与历史归档 | 已实现 |
| DDS 预算截断续打、逐候选搜索状态与 PIMC 样本计数 | 已修复；估计仍有策略偏差 |
| 实际胜负统计、组级保守区间、干预组排除与动作日志 | 已修复，已有离线配对结果 |
| 新版真实 LLM / Laya 横向比较及多模型排名 | 待重测 |
| 请求级原生/确定性归因、成本与服务分段耗时 | 待补 |
| 更大独立发牌集、保留场景、座位/庄家平衡、LLM 实战 | 待扩展 |

下一轮先重测模型，再扩大普通视角对战；同时收紧宽松场景的判定。任何数据、裁判或提示词修改都需更新指纹并重跑，不把历史成绩混进新结论。
