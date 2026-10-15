# 全阶段 AI 引擎与模型评估方案

> 文档类型：当前评测协议；内容复核：2026-10-15。套件/配置/源码不同的证据分别报告。返回[文档索引](../README.md)。

更新日期：2026-10-15；当前场景套件：**1.4.0**，开发集 **65** 例（叫分/定主/扣底/出牌为 **12/11/12/30**），独立目录保留集 **40** 例（**8/8/8/16**）。座位旋转和花色置换共 96 种变换下核对跨集合互斥与保留集内部唯一性；规范型使用实际阶段观察，包含默认值与公开绝门。套件版本相同也须核对数据、裁判和源码指纹；历史 55 题成绩不能直接与扩充后的通过率比较。覆盖分布与历史限制见[覆盖补强说明](evaluation-coverage.md)。

三个评测入口均接受 `--dataset=dev|holdout`、`--dataset dev|holdout`，或以 `--holdout` 选择保留集；默认开发集。保留集报告和 manifest 标识数据集身份。保留集经过人工审查和合法性回归，用于外样诊断；最终牌力确认仍使用未参与调参的发牌组。最新策略对照与原始证据见[搭档配合评测](../../experiments/partner-cooperation-20261015/README.md)。

[套件 1.4.0 覆盖与离线诊断](evaluation-coverage.md)记录新版开发集；[1.2.0 历史结果](evaluation-results.md)保留旧版修复验证；[评测产物索引](../../experiments/results/engine-model-eval/README.md)提供固定报告和原始日志。本文描述方法、可运行命令和待补能力，不维护第二份成绩榜。返回[文档索引](../README.md)。

## 1. 目标与评估分层

需要分别回答：动作是否合法、战术是否合理、整局是否赢牌、服务是否可靠、等待时间是否可接受。单步场景成绩用于定位问题，不能替代实战赢副率；自然语言解释用于诊断，不按篇幅评分。

| 层次 | 检查内容 | 当前入口 |
| --- | --- | --- |
| L0 数据与契约 | 牌张守恒、座位/轮次/得分、合法候选、观察隔离 | 场景构造器和回归测试 |
| L1 固定场景 | 开发集 12/11/12/30，共 65 例；保留集 8/8/8/16，共 40 例 | `eval:engines`、`eval:llm`，按 dataset 分栏 |
| L2 配对实战 | 同种子交换双方，从叫分至实际结算 | `scripts/match-battle.ts` |
| L3 服务与产品 | 网络、取消、降级、Worker、UI 等待、成本 | 已有生命周期测试与日志；完整端到端测量待补 |

公开场景用于开发回归。确认牌力需另用未参与调参的发牌种子和保留场景，避免仅优化到这 65 题。

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

完整牌张、局面、描述和声明式通过条件以 [data/evaluation](../../data/evaluation) 的四个 JSON 文件为准。[scenarios.ts](../../src/ai/eval/scenarios.ts) 保留原场景数组接口，由通用适配器生成 `setup`、`expectedCriteria`。下表列的是当前通过条件；这些固定局面的经验判定不等于一般局面的最优动作证明。手牌分值/HCP 应从牌张计算，部分历史描述的手工数字不能作为裁判依据。

### 样本维护

在对应阶段文件追加对象即可新增使用现有条件类型的样本，无需修改 TS。每项包含 `id`、`name`、`phase`、`category`、`description`、`optimalActionDesc`、`setup`、`expected`；ID 在四个文件间唯一，数组顺序即运行顺序。牌张使用点数在前的 `"10S"`、`"AH"` 等记法，历史中的 `card` 也使用相同字符串。

| 数据文件 | `setup` | `expected` |
| --- | --- | --- |
| [bidding.json](../../data/evaluation/bidding.json) | `seat`、12 张 `hand`；可选最高叫分、叫分者和叫分历史 | `bids` 允许列表（`null` 为不叫），或 `minBid` / `maxBid` 闭区间，二者择一 |
| [trump.json](../../data/evaluation/trump.json) | `seat`、12 张 `hand`；可选 `winningBid` | `suits` 允许花色列表 |
| [bury.json](../../data/evaluation/bury.json) | `seat`、16 张 `hand16`、`trump`；可选 `winningBid` | 必填 `zeroPointsBuried: true`；可选 `trumpsPreserved`、`minVoidsCreated`、`includeCards`、`excludeCards` |
| [playing.json](../../data/evaluation/playing.json) | 自身手牌、主牌、庄家、叫分、领出家、轮次及当前出牌；可选完整历史、已知底牌、双方得分和绝门信息；100 分须提供 `revealedHand: { seat, cards }` | `cards` 允许牌列表、`excludeCards` 禁止牌列表，至少声明一项；同时声明时两项均须满足 |

所有条件都先要求动作合法；其余声明条件按“且”组合。叫分默认最高叫分为 0，定主和扣底默认中标 75；出牌默认历史和当前累计得分为空／0，默认无已知绝门。扣底逐牌条件读取实际扣牌动作，缺少动作时按空列表处理，保持原有语义。允许列表不能为空，未知字段、重复 ID、非法座位和牌记法会在加载时拒绝；物理守恒及历史矛盾继续由现有构造器校验，错误注明样本 ID。

通用条件类型见 [types.ts](../../src/ai/eval/types.ts)，加载及判定见 [scenarioLoader.ts](../../src/ai/eval/scenarioLoader.ts)。每次 `setup` 克隆嵌套数据，运行时修改手牌或历史不会污染后续样本。维护样本后运行 `pnpm test` 和 `pnpm build`，规则边界与信息隔离必须继续通过。

以下阶段表保留原 55 例的题理说明；当前全量输入、元信息和通过条件以 JSON 为准。

### 3.1 叫分：原 10 例

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
| `bid-rebid-raise` | 对手先叫 75，持六张强套首次竞争叫分（保留历史 ID） | 80 / 85 |
| `bid-east-flat-single-ace` | 东家单 A 均型放弃 | Pass |
| `bid-west-six-card-controls` | 西家六张控制套稳健起叫 | 70 / 75 / 80 |

### 3.2 定主：9 例

| ID | 局面重点 | 当前接受动作 |
| --- | --- | --- |
| `trump-clear-longest` | 黑桃明显最长 | S |
| `trump-equal-length-controls` | 红心/方块各 5 张，比较控制力 | H |
| `trump-trap-points-vs-length` | 红心两张高分对梅花六张长套 | C |
| `trump-extreme-7card-dominance` | 方块七张对黑桃三张大牌 | D |
| `trump-protect-naked-honors` | 黑桃/梅花各五张，避免短门分牌定主 | S |
| `trump-4-4-choice-void-threat` | 黑桃/红心各四张，副牌单张可扣空 | S / H |
| `trump-solid-vs-fragile-length` | 黑桃 AKQJ10 对红心六张小牌 | S |
| `trump-east-diamonds-85` | 东家 85 分长方块 | D |
| `trump-west-hearts-100` | 西家 100 分长红桃 | H |

### 3.3 扣底：10 例

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
| `bury-east-diamonds-void-80` | 东家方块主断黑桃 | 扣 2S/3S/4S 加一张副牌小牌；保留全部主牌 |
| `bury-west-hearts-100-clear-clubs` | 西家 100 分断梅花 | 扣 2C/4C/7C/9C；保留全部主牌 |

部分判定比场景意图宽：保护 K 的一例未单独禁止扣 `KC`；保留叉子的一例未强制扣四张方块。后续收紧裁判须升级套件并重跑，不能把旧通过率解释为已完整验证这些战术。

### 3.4 出牌：26 例

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
| `play-second-east-low-hearts` | 东家第二手副牌留 K | `2H` |
| `play-second-west-duck-ace` | 西家第二手对 A 不送分 | `2C` |
| `play-third-east-secure-points` | 东家第三手 A 吃分 | `AC` |
| `play-third-west-feed-master-trump` | 西家第三手大主下喂分 | `10D` / `5D` |
| `play-open-declarer-draw-diamonds` | 100 分庄家明牌清方块 | `AD` |
| `play-open-partner-feed-trump` | 100 分明牌搭档第三手喂分 | `10D` / `5D` |
| `play-open-defender-capture-ten` | 100 分闲家第三手截获 10 | `AH` |
| `play-known-kitty-club-lead` | 庄家已知底牌后清梅花 | `AC` |
| `play-club-ruff-25` | 东家梅花主毙杀 25 分 | `2C` / `3C` |
| `play-late-declarer-feed-five` | 第十墩喂分锁定 75 | `5D` |
| `play-late-defender-win-five` | 第十墩闲家争 5 锁定 | `KD` / `AD` |
| `play-late-lead-lock-contract` | 第十墩兑现 A 成局 | `AD` |
| `play-middle-third-duck-ace` | 第六墩第三手对 A 保分 | `2D` |
| `play-second-open-defender-win` | 第二手主 A 截分立即赢副 | `AH` / `KH` |

“当前领先”不等于“稳赢”。喂分样例需证明后手不能超车；搭档梅花绝门不证明仍有主牌，因此不能把 `3C` 设为唯一答案。[llmEvaluator.ts](../../src/ai/engines/llm/llmEvaluator.ts) 已依据当前实际赢家及稳赢信息评分，再由场景条件判断通过。

### 3.5 数据构造与可见性

[deckHelper.ts](../../src/ai/eval/deckHelper.ts) 校验牌张守恒、手牌数量、出牌顺序、领出家连续性、每墩真实赢家、庄闲得分，以及绝门信息与手牌/历史是否矛盾。出牌历史中任一墩达到庄家 `B` 或闲家 `105 - B` 后不得继续出题；推导出的绝门会合并到观察。约束求解器另验证存在合法暗牌和四张零分底牌补全。`knownBuriedCards` 仅允许庄家提供；100 分必须提供庄家搭档当前剩余明牌，张数、座位、自身明牌一致性和与历史重叠均校验。扣底阶段庄家 16 张；后半局手牌数根据历史扣减，不能仍要求每家 12 张。

完整牌局只供构造与裁判使用。引擎接收 [decisionObservation.ts](../../src/ai/decisionObservation.ts) 投影出的可见信息，不传发牌 seed、其他人的暗牌或暗底。100 分搭档明牌按规则公开；God-mode 集成记录单列，不并入普通玩家视角榜单。

## 4. 实验协议与指标

### 场景实验

先区分非法动作与合法但未达战术期望的动作。未通过期望的合法动作最多计 60 分，并降为次优。报告输出通过率、最终合法率、各阶段均分、阶段等权宏平均、P50/P95、回退/Mock 数与决策归因。

宏平均按本次覆盖阶段等权；全阶段样本量为 10/9/10/26。阶段过滤的运行不可与全阶段总分直接比较。延迟是执行器调用耗时，取整为毫秒；P95 使用排序后 `floor(0.95 × n)` 下标（上限为末项）。记录 0 ms 表示四舍五入，不表示没有耗时，也不包含 UI 与所有服务链路。

场景评测归因分 `model`、`search/heuristic`、`deterministic`、`fallback`、`mock`、`execution-failure`。仅实际返回备用动作才记为 `fallback`；抛异常且未返回动作单列为 `execution-failure`，记录 `failureReason`，不填 `fallbackReason`。失败不能通过战术裁判，也不能计为模型原生成功。

LLM 的 SDK / Fetch 与 System One 在 HTTP 传输调用点通过每次决策独立的观察回调计数。`actualModelCalls` 是实际 HTTP 尝试数，包含连接失败、HTTP 失败和 SDK 重试；`actualModelRetries` 是同一次请求中第 2 次及以后的尝试数，不根据动作来源推算。SDK 的 Chat / Completions、流式与非流式共用计数点；流式 token 分块不增加请求数。尚未进入传输的排队、取消、唯一候选和未联网 Mock 计为 0。注入客户端若未声明并实现 `supportsModelRequestTelemetry`，对应请求/重试数写 `null`（未采集），不冒充 0；汇总中有未采集项时总请求/重试数也为 `null`。

`nativeCallCount` 是确认至少发起一次请求的逻辑决策数，重试不重复计算。`nativeSuccessCount` 只计真实请求后直接返回的合法模型动作；`nativeSuccessRate = nativeSuccessCount / nativeCallCount`，零调用时为 `null`。该指标衡量决策取得原生合法动作的成功率，不是逐次 HTTP 成功率，也不是只以已输出动作为分母的原生合法率。计划模型调用数仍表示所选引擎阶段的逻辑调用计划，可能包含无需联网的确定性动作。系统最终合法率继续以全部场景为分母，须结合 `executionFailureCount` 查看无动作失败。

每题保存 `logicalDecisionId = runId:场景索引`、`modelRequestCount`、`modelRetryCount` 和 `modelRequests`（各次尝试序号）；配置快照中的 `attributionProtocolVersion: 2` 参与指纹，旧口径报告不能直接复用。原生非法输出与解析失败的细分、完整回退链、usage 和服务分段耗时仍需补齐。

### 复式实战

每个种子交换东西/南北各打一局，从叫分运行到终局；种子按起点加 `137 × 组号` 递增。主指标按规则结算的 `winnerSide` 计算实际赢副，累计吃分只作辅助指标。提前锁定胜负后保留未打出分，不能按桌面累计吃分多少判断赢家。

以发牌组为独立样本，令每组差值 `x = (A 赢副数 − B 赢副数) / 2`，范围 [-1,1]。当前 95% Hoeffding 保守区间为 `mean(x) ± sqrt(2 × ln(40) / n)`，截取到 [-1,1]。即使所有组都是 1:1，也不能给出零宽区间。该区间依赖独立发牌组假设；固定十组是回归检查，不能据此宣布显著优势。

全 Pass 重发超过三次后强制叫 70 的组会标记并排除主指标。发牌随机源与引擎采样分离；时间预算和随机采样使同种子重新运行未必产生同样决策。日志重放按记录的实际动作验证终局，不要求重新调用引擎得到相同动作。

当前 `match-battle.ts` CLI 支持 `bridge-fast`、`bridge-deep`、`algorithm-optimized`、`laya`，尚未接入 LLM；P3 产品模拟已支持模型 profile，范围见[模拟说明](../features/simulations.md)。固定前置阶段的旧搜索实验是另一种协议，不能与全生命周期比赛合并统计。

### 选型规则

分开评价牌力、交互速度、离线可用性和模型可靠性。区间跨 0 时写“尚无可靠优势”；模型未在同版数据下比较时写“最佳模型待测”。生产端到端 P95、成本、服务故障率尚无完整测量，不能用离线单步数据代替。

## 5. 版本、缓存与关键日志

[fingerprint.ts](../../src/ai/eval/fingerprint.ts) 与 [eval-artifacts.ts](../../scripts/eval-artifacts.ts) 形成运行指纹：

| 字段 | 内容 | 用途 |
| --- | --- | --- |
| `suiteVersion` | 当前 1.4.0 | 标记裁判/数据协议版本 |
| `dataHash` | 完整 JSON 样本定义、实际场景输入、候选、描述及构造／判定函数的 SHA-256 | 识别场景或期望变化，JSON 编辑也会使缓存失效 |
| `configHash` | 实际配置白名单、并发、裁判及源码哈希 | 识别引擎/提示词/预算变化 |
| `codeHash` | 当前 `src`/`scripts` TS/TSX、package.json、锁文件内容 | 包含未提交修改，不只看 Git HEAD |

只有四项全部一致才复用横向成绩；旧根目录报告写入 `history-*` 后再更新。各次运行保存在独立目录。文档编辑不改变当前源码指纹。

| 产物 / 字段 | 排查用途 |
| --- | --- |
| `summary.json` / `manifest.json` 的 `coverage` | 本次实际运行的座位、位置、主花色、合同档、角色、轮次、分线及明牌/底牌覆盖；阶段筛选时不借用全套统计 |
| `manifest.json`、配置快照、指纹 | 确认使用哪版数据、代码、思考档位、超时、并发及 `disableBidAdvice` |
| `decisions.ndjson` 的 `scenarioId`、`inputObservation`、`candidates` | 找到失败样例与完整可见手牌/历史，排查输入和候选 |
| `rawResponse` 的动作、`rawText`、`requestPayload` | 比对实际请求、原始响应、解析动作与解释；按引擎可用性保存 |
| `candidateEvaluations`、`worldsEvaluated`、`searchStatusCounts` | 查看候选样本与 `exact/depth_limit/node_limit`；区分精确求解与续打估计 |
| `passed/isLegal/score/details/errorCode/fallbackReason/failureReason` | 区分数据、协议、非法动作、战术失误、真实回退与无动作失败 |
| `logicalDecisionId/modelRequestCount/modelRetryCount/modelRequests` | 关联每次逻辑决策及实际 HTTP 尝试，检查重试与零调用；未采集为 null |
| `boards.ndjson` 的两局观察/决策、庄家、叫分、赢家、未打分、重发与干预标记 | 重放关键动作、核对规则结算与组级统计 |

模型真实版本/量化、服务请求 ID、token usage、首 token/排队/解码时间、Worker 和 UI 分段耗时仍需额外采集；缺失不能填成 0。现有内存 logger 有容量上限，评测另写 NDJSON 保存完整运行。

配置导出使用白名单；API Key、Authorization、Cookie 不进入产物。全量重放材料不回灌到其他座位的模型输入。

## 6. 可运行命令

在项目根目录执行。脚本读取 `.env`；密钥通过环境配置提供，避免写在命令行。

```bash
# 本地验证
pnpm eval:coverage  # 仅审计样本，不调用模型
pnpm typecheck
pnpm test
pnpm build

# 离线三引擎：55 场景，每次每场景一次
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
| 55 场景、覆盖审计、可见观察、合法补全与历史得分校验 | 已实现并有回归测试 |
| 场景执行器、阶段统计、配置指纹、独立日志与历史归档 | 已实现 |
| DDS 预算截断续打、逐候选搜索状态与 PIMC 样本计数 | 已修复；估计仍有策略偏差 |
| 实际胜负统计、组级保守区间、干预组排除与动作日志 | 已修复，已有离线配对结果 |
| 新版真实 LLM / Laya 横向比较及多模型排名 | [Prompt 2.0 的 35 题对照](llm-prompt-optimization.md)已保留；另有[1.4.0 跨 run 诊断](../../experiments/results/engine-model-eval/qwen-v14-full-suite-merged.md)，指纹不同，不能建立同版排名；Laya/多模型受控比较待测 |
| 场景评测 HTTP 请求/重试计数、确定性动作与无动作失败归因 | 已实现；见 `tests/eval-request-attribution.test.ts`，未采集的注入客户端写 null |
| 原生非法输出细分、成本与服务分段耗时 | 待补 |
| 更大独立发牌集、保留场景、座位/庄家平衡、CLI LLM 实战 | 待扩展；P3 模型配置模拟已经存在，不等于独立牌力确认 |

当前状态与执行顺序统一见[开发路线](../planning/development-roadmap.md)，研究验收见[AI 研究规格](../planning/ai-research.md)。任何数据、裁判或提示词修改都需更新指纹并重跑，不把历史成绩混进新结论。


## P3 持久模拟报告

产品模拟入口及 HTTP 字段见 [P3 实现说明](../features/simulations.md) 与 `src/history/simulation.ts`。历史库中的运行保存 `sourceHash`、`implementationVersion`、`searchSeed` / `searchRandomProtocol`、四座与备用配置版本、完整种子集合、协议及全部预算。全生命周期与固定前三阶段分开报告；历史续打不参与换边统计。

报告保留不完整/失败组、实际赢家与每副复盘引用。仅完整双局组进入组级区间；模型原生输出合法率排除无动作执行失败，系统最终合法率另列；确定性动作不算模型动作，备用失败尝试不算已执行回退。P3 持久模拟已通过同一请求回调机制，将主/备用配置的 HTTP 尝试存入动作评估或无动作故障；请求协议 1 的次数、未知项和重启续跑汇总见 [P3 实现说明](../features/simulations.md)。usage 与服务分段耗时仍未采集，不根据逻辑动作数推算。小批跑验证工程，不构成默认引擎替换或排名证据。
