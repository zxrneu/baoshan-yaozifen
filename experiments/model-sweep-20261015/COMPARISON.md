# 模型与思考档位实测（2026-10-15）

**本轮建议优先使用 :6195 的 qwen38_27b，思考档位 low。** 在公开55题、8192 token/180秒预算下，low通过52/55（94.5%），合法55/55，执行失败0，P50 20.8秒、P95 68.4秒。相比同模型关闭思考，净多通过12题；相比medium，少等待且多通过1题，但单次1题差不能解释为可靠牌力优势。

若更看重秒级响应，选 :6091 的 qwen35_27b + none：P50 1.48秒、P95 1.97秒，合法55/55、零执行失败；场景通过45/55（81.8%），出牌19/26，低于开启思考的25/26。它是本轮速度选择，而不是通过率最高的选择。

qwen35开启思考通过51/55，有2次8192 token耗尽导致最终文本为空，P50 45.8秒。qwen38 medium通过51/55，零失败，P95升至134.1秒；xhigh通过46/55，有5次180秒超时及2次SDK连接失败，P95 180秒。当前部署与预算下，没有看到升级medium/xhigh的实用收益；不能将外部网络和服务负载故障归因为权重能力差。

35的low/medium/high在当前模板上等价，后两组经参数探测后跳过完整重复；38最高档必须传xhigh，high会被服务拒绝。实验适配器仅修改实际传输，产品未新增xhigh支持。六个有效配置各55题，共330次决策/SDK传输尝试，底层完整终态记录328条，另2次连接失败只有SDK侧失败记录，已保留且注明未知。

这些是同一公开开发集的一次固定场景结果，**不是整副牌赢副率或独立泛化确认**。Radeon仅查询模型清单，用户取消后没有发送推理请求。复用既有观察、提示词与裁判，未修改产品行为。先通过隔离/完整性/归因相关72项测试；交付前全量83个测试文件、950项测试及pnpm build再次通过。原始日志见checks目录。

统一公开开发套件 1.4.0，四阶段 55 题，每配置独立一轮。当前报告只汇总已完成的 run，未完成批次不计入排行。

服务映射：local35 = :6091 / qwen35_27b；local38 = :6195 / qwen38_27b。IP与鉴权头不进入报告。

固定 chat/json_object、max_tokens=8192、每端点并发2、请求超时180秒、重试0、叫分建议开启、Mock和回退关闭。不同端点同时运行；延迟受各服务资源和排队影响。

沿用产品客户端：显式设置reasoning_effort时不发送temperature，实际温度/top_p/随机种子采用各服务默认值（未采集）。这是当前部署的对照，不是固定量化、硬件和采样参数后的纯权重比较。

| 服务 / 模型 | 档位 / 轮次 | 通过 | 合法 | 原生成功 | 执行失败 | P50秒 | P95秒 | 阶段宏均分 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| local38 / qwen38_27b | low / r1 | 52/55 (94.5%) | 55/55 | 55/55 | 0 | 20.77 | 68.43 | 91 |
| local38 / qwen38_27b | medium / r1 | 51/55 (92.7%) | 55/55 | 55/55 | 0 | 24.72 | 134.09 | 90 |
| local35 / qwen35_27b | low / r1 | 51/55 (92.7%) | 53/55 | 53/55 | 2 | 45.82 | 134.27 | 89 |
| local38 / qwen38_27b | xhigh / r1 | 46/55 (83.6%) | 48/55 | 48/55 | 7 | 27.83 | 180.01 | 83 |
| local35 / qwen35_27b | none / r1 | 45/55 (81.8%) | 55/55 | 55/55 | 0 | 1.48 | 1.97 | 87 |
| local38 / qwen38_27b | none / r1 | 40/55 (72.7%) | 54/55 | 54/55 | 1 | 2.76 | 5.11 | 83 |

## 四阶段分布

| 配置 | 叫分 | 定主 | 扣底 | 出牌 |
| --- | --- | --- | --- | --- |
| local38-qwen38_27b-low-r1 | 10/10 | 7/9 | 10/10 | 25/26 |
| local38-qwen38_27b-medium-r1 | 9/10 | 8/9 | 10/10 | 24/26 |
| local35-qwen35_27b-low-r1 | 9/10 | 8/9 | 9/10 | 25/26 |
| local38-qwen38_27b-xhigh-r1 | 9/10 | 8/9 | 9/10 | 20/26 |
| local35-qwen35_27b-none-r1 | 9/10 | 8/9 | 9/10 | 19/26 |
| local38-qwen38_27b-none-r1 | 9/10 | 9/9 | 5/10 | 17/26 |

## 传输与思考控制

| 配置 | HTTP请求/重试 | finish_reason | 空content | 含思考响应 | 思考字符中位数 | 已采集输出tokens / usage覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| local38-qwen38_27b-low-r1 | 55/0 | {'stop': 55} | 0 | 55 | 2066 | 60226 / 55/55 |
| local38-qwen38_27b-medium-r1 | 55/0 | {'stop': 55} | 0 | 55 | 2327 | 72394 / 55/55 |
| local35-qwen35_27b-low-r1 | 55/0 | {'stop': 53, 'length': 2} | 2 | 55 | 6705 | 182881 / 55/55 |
| local38-qwen38_27b-xhigh-r1 | 55/0 | {'stop': 48} | 0 | 48 | 1523.0 | 59814 / 48/55 |
| local35-qwen35_27b-none-r1 | 55/0 | {'stop': 55} | 0 | 0 | 0 | 3507 / 55/55 |
| local38-qwen38_27b-none-r1 | 55/0 | {'stop': 55} | 0 | 0 | 0 | 4727 / 55/55 |

请求次数是SDK fetch边界记录的传输尝试，不表示已证明每次均到达服务端。原始底层终态记录的覆盖如下；不补造缺失记录。

- local38-qwen38_27b-low-r1：SDK尝试55次，底层终态55条，缺失0条。
- local38-qwen38_27b-medium-r1：SDK尝试55次，底层终态55条，缺失0条。
- local35-qwen35_27b-low-r1：SDK尝试55次，底层终态55条，缺失0条。
- local38-qwen38_27b-xhigh-r1：SDK尝试55次，底层终态53条，缺失2条。
- local35-qwen35_27b-none-r1：SDK尝试55次，底层终态55条，缺失0条。
- local38-qwen38_27b-none-r1：SDK尝试55次，底层终态55条，缺失0条。

xhigh的两次Connection error保留在统一裁判的失败列表，缺失底层终态记录与底层异常cause，根因未采集；不能认定为模型策略错误。另有5次明确的180秒TIMEOUT。没有为补全轨迹额外重测或丢弃这些失败。


## 同题开关对照

以下是同一公开题集的一次配对运行，不是独立发牌的实战样本。

| 服务 | 开启档位 | 关闭失败→开启通过 | 关闭通过→开启失败 | 总通过数变化 | P50延迟倍数 |
| --- | --- | --- | --- | --- | --- |
| local38 | low | 14 | 2 | +12 | 7.5倍 |
| local38 | medium | 13 | 2 | +11 | 8.9倍 |
| local35 | low | 8 | 2 | +6 | 30.9倍 |
| local38 | xhigh | 12 | 6 | +6 | 10.1倍 |

## 未通过的逐题证据

### local38-qwen38_27b-low-r1

- `trump-trap-points-vs-length`：定主 H；STRATEGY_MISS；期望 定梅花 (C) (绝不定红桃 H)
- `trump-extreme-7card-dominance`：定主 S；STRATEGY_MISS；期望 定方块 (D)
- `play-third-east-secure-points`：出牌 QC；STRATEGY_MISS；期望 跟 AC

### local38-qwen38_27b-medium-r1

- `bid-extreme-long-suit`：叫 80 分；STRATEGY_MISS；期望 叫 70 分 (起叫做庄)
- `trump-trap-points-vs-length`：定主 H；STRATEGY_MISS；期望 定梅花 (C) (绝不定红桃 H)
- `play-third-east-secure-points`：出牌 QC；STRATEGY_MISS；期望 跟 AC
- `play-known-kitty-club-lead`：出牌 7C；STRATEGY_MISS；期望 领 AC

### local35-qwen35_27b-low-r1

- `bid-west-six-card-controls`：未知动作；SCHEMA_ERROR；期望 叫 70/75/80 分
- `trump-extreme-7card-dominance`：定主 S；STRATEGY_MISS；期望 定方块 (D)
- `bury-keep-tenace`：扣底 [8D, 6D, 2D, 3H]；STRATEGY_MISS；期望 扣除方块4张小牌，完整保留 ♥AQ 叉子与 ♣K
- `play-safe-exit`：未知动作；SCHEMA_ERROR；期望 出 ♦4 或小杂牌安全脱手 (严禁出 10D 送分)

### local38-qwen38_27b-xhigh-r1

- `bid-rebid-raise`：Pass；STRATEGY_MISS；期望 叫 80 或 85 分
- `trump-trap-points-vs-length`：定主 H；STRATEGY_MISS；期望 定梅花 (C) (绝不定红桃 H)
- `bury-zero-point-redline`：未知动作；TIMEOUT；期望 恰好扣 4 张本人非分牌，0 分牌入底
- `play-feed-partner-void`：未知动作；TIMEOUT；期望 领出 ♦K (KD) 兑现或 ♣3 (3C) 尝试搭档将吃
- `play-safe-exit`：未知动作；TIMEOUT；期望 出 ♦4 或小杂牌安全脱手 (严禁出 10D 送分)
- `play-second-west-duck-ace`：未知动作；NETWORK_ERROR；期望 跟 2C
- `play-third-east-secure-points`：未知动作；TIMEOUT；期望 跟 AC
- `play-third-west-feed-master-trump`：未知动作；NETWORK_ERROR；期望 跟 10D/5D
- `play-open-declarer-draw-diamonds`：未知动作；TIMEOUT；期望 领 AD

### local35-qwen35_27b-none-r1

- `bid-strong-high-bid`：叫 75 分；STRATEGY_MISS；期望 叫 85 ~ 95 分 (或 100 分)
- `trump-extreme-7card-dominance`：定主 S；STRATEGY_MISS；期望 定方块 (D)
- `bury-protect-trapped-king`：扣底 [8D, 6D, 2D, 4C]；STRATEGY_MISS；期望 扣除方块小废牌，保留 ♣K4 与 ♥A 控制张
- `play-lead-draw-trumps`：出牌 6S；STRATEGY_MISS；期望 出 ♠A (AS)
- `play-second-hand-low`：出牌 KD；STRATEGY_MISS；期望 跟出 ♦2 (2D)
- `play-third-hand-high`：出牌 4C；STRATEGY_MISS；期望 出 ♣Q (QC) 或 ♣K (KC)
- `play-safe-exit`：出牌 10D；STRATEGY_MISS；期望 出 ♦4 或小杂牌安全脱手 (严禁出 10D 送分)
- `play-open-declarer-draw-diamonds`：出牌 10D；STRATEGY_MISS；期望 领 AD
- `play-open-partner-feed-trump`：出牌 2D；STRATEGY_MISS；期望 跟 10D/5D
- `play-known-kitty-club-lead`：出牌 4S；STRATEGY_MISS；期望 领 AC

### local38-qwen38_27b-none-r1

- `bid-competitive-pass`：叫 90 分；STRATEGY_MISS；期望 Pass (不叫 / null)
- `bury-preserve-trumps`：未知动作；EXECUTION_ERROR；期望 全部 7 张主牌保留，扣副牌非分牌
- `bury-double-voids`：扣底 [8S, 6S, 4H, 3H]；STRATEGY_MISS；期望 扣除 ♦2, ♥4, ♥3 及一张黑桃杂牌，形成双绝门
- `bury-clear-long-garbage`：扣底 [8S, 2S, 9D, 8D]；STRATEGY_MISS；期望 精确扣除 ♦9, ♦8, ♦6, ♦2 达成纯绝门
- `bury-keep-tenace`：扣底 [6D, 8D, 2D, 3H]；STRATEGY_MISS；期望 扣除方块4张小牌，完整保留 ♥AQ 叉子与 ♣K
- `bury-east-diamonds-void-80`：扣底 [2S, 3S, 2C, 3C]；STRATEGY_MISS；期望 扣 2S/3S/4S 加一张副牌小牌
- `play-lead-draw-trumps`：出牌 8H；STRATEGY_MISS；期望 出 ♠A (AS)
- `play-slough-ruff-for-points`：出牌 9S；STRATEGY_MISS；期望 出小主 ♠2 (2S) 或 ♠3 (3S) 毙杀截获 20 分
- `play-second-hand-low`：出牌 KD；STRATEGY_MISS；期望 跟出 ♦2 (2D)
- `play-feed-partner-void`：出牌 4S；STRATEGY_MISS；期望 领出 ♦K (KD) 兑现或 ♣3 (3C) 尝试搭档将吃
- `play-safe-exit`：出牌 10D；STRATEGY_MISS；期望 出 ♦4 或小杂牌安全脱手 (严禁出 10D 送分)
- `play-second-east-low-hearts`：出牌 KH；STRATEGY_MISS；期望 跟 2H
- `play-third-east-secure-points`：出牌 QC；STRATEGY_MISS；期望 跟 AC
- `play-known-kitty-club-lead`：出牌 KC；STRATEGY_MISS；期望 领 AC
- `play-club-ruff-25`：出牌 KC；STRATEGY_MISS；期望 出 2C/3C

## 跳过的等价参数组

- local35 / qwen35_27b / high：模板等价；low/medium/high序列化输入token哈希完全相同，仅支持思考开关。low组运行全55题作为开启基线，不将此记录计入排行。
- local35 / qwen35_27b / medium：模板等价；low/medium/high序列化输入token哈希完全相同，仅支持思考开关。low组运行全55题作为开启基线，不将此记录计入排行。

## 结论边界与复现

55题是公开开发集，单次差1~2题不足以可靠判断优势；同题重复也不是独立泛化确认。这里没有整副牌配对换边赢副率证据，不能据此宣称哪个模型实战牌力更强。模型别名不证明真实权重、量化与硬件相同。

qwen38服务拒绝high，支持xhigh；实验只在传输适配器中把对应字段改成xhigh，manifest记录实际发送值。该组decisions/summary中的requestPayload是SDK改写前的high快照，不能当作线上实际请求体；线上请求以transport.ndjson里的request.reasoning_effort=xhigh为准，两份证据均保留。

已用tokenize的chat_template_kwargs显式传入enable_thinking/reasoning_effort验证：local35的low/medium/high产生完全相同的23个token（SHA256一致），none为25个token；local38的low/medium/xhigh分别为53/23/65个token，none为25个token。裸传reasoning_effort的tokenize接口忽略了该字段，不能用早先裸字段探测判断模板语义。原始证据见template-probes.json。

因此local35以low的全55题作为“思考开启”基线，medium/high探测后标记跳过，不生成或复用虚构分数。[Qwen3.5官方模板](https://huggingface.co/Qwen/Qwen3.5-27B/blob/main/chat_template.jinja)只处理enable_thinking；[Qwen3.8官方模板](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/chat_template.jinja)分别给low和xhigh注入不同指令，medium不注入额外思考指令。模板长度变化不证明真实权重版本，实际chat响应仍用于验证有无思考输出。

实测local35为vLLM 0.26.0，local38为vLLM 0.28.0。Radeon仅查询模型清单，用户取消后未发送推理请求。

max_tokens上限同时约束思考及最终文本；finish_reason=length、空content及失败均保留，不能把预算不足当作纯策略能力问题。无fallback/Mock时的合法率包含执行失败，原生成功表示模型动作成功而非战术通过。

每个已完成run保留summary.json、manifest.json、report.md、decisions.ndjson、transport.ndjson、timing.json。transport成功响应记录含真实请求体、原始响应、usage、finish_reason和思考长度；超时异常记录仅有时间、耗时和错误，未捕获该次完整请求体，也没有响应/usage。不保存鉴权头。token数仅汇总已采集usage，并标注覆盖率，未知量不视为零。端点以local35/local38/radeon标识。

```bash
pnpm exec vite-node experiments/model-sweep-20261015/run.ts local
# Radeon 仅在用户确认预算后，以SWEEP_RADEON_BUDGET设置上限运行radeon模式
python3 experiments/model-sweep-20261015/summarize.py
```
