# AI 评测操作手册

> 文档类型：当前操作手册；内容复核：2026-10-14。产品默认配置与实验入口的默认值分别看源码和 manifest。返回[文档索引](../README.md)。

本文只讲**怎么跑**：命令、参数、产物位置、跑完怎么看、出问题怎么判。方法与指标口径见[全阶段 AI 引擎与模型评估方案](evaluation-plan.md)；样本覆盖见[覆盖补强说明](evaluation-coverage.md)；已出结论见[结果与修复记录](evaluation-results.md)。

更新日期：2026-10-13；当前套件 **1.4.0**，共 **55** 例。

## 1. 准备

```bash
node -v          # 必须 >= 22.16.0（历史库依赖 node:sqlite）
pnpm install
```

密钥与端点走 `.env`（被 gitignore，不要写进命令行），模板见 `.env.example`：

| 变量 | 用途 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` / `LLM_PROTOCOL` | 真实模型评测 |
| `LLM_TIMEOUT_MS` | 模型执行预算；两个场景 CLI 未配置时默认 60000 ms，可由环境/参数覆盖，实际值查看 manifest |
| `LLM_CONCURRENCY` / `LLM_MAX_CONCURRENCY` | 并发上限，保护 GPU 与 vLLM 队列 |
| `LAYA_BASE_URL` / `LAYA_MODEL` / `LAYA_TIMEOUT_MS` | Laya 非自回归引擎 |

开跑前按当前模型服务提供的健康接口或 `/models` 检查连通性、鉴权与模型是否加载。端点和密钥从环境读取，不写入报告；记录探活时间和实际响应。成功探活只证明该次请求可用，不保证后续延迟或完整批次稳定。

## 2. 零成本检查（先跑这些）

```bash
pnpm eval:coverage      # 只审计样本覆盖，不调用任何引擎/模型
pnpm typecheck
pnpm test               # tests/**/*.test.ts
pnpm build              # 类型检查 + 生产构建
```

`eval:coverage` 输出本次样本的阶段/座位/位置/花色/合同档覆盖计数。改过评测数据或裁判后，先看它，再决定要不要花钱跑模型。

## 3. 离线引擎场景评测（不调用模型，秒级～分钟级）

```bash
# 三套离线引擎全 55 题
pnpm eval:engines --engine offline --concurrency 1

# 单个引擎
pnpm eval:engines --engine bridge-deep --concurrency 1

# 单引擎 + 单阶段（阶段：bidding | trump | bury | playing）
pnpm eval:engines --engine bridge-deep --phase playing --concurrency 1
```

要点：

- 参数是**单数** `--engine`。未指定时跑全部五个配置（含 `laya`、`llm`，需要服务在线）。
- `--engine` 支持配置 ID 或子串筛选：`bridge-fast`、`bridge-deep`、`algorithm-optimized`、`laya`、`llm`。
- `offline` 是筛选词，等价于 `bridge-fast` + `bridge-deep` + `algorithm-optimized`。
- `--fresh-llm` 只控制兼容缓存里的 LLM 成绩是否重跑，对离线引擎无影响。
- 阶段过滤的成绩**不能**和全阶段总分直接比（宏平均按本次覆盖阶段等权）。

## 4. 真实模型场景评测

```bash
# 全阶段 55 题（Qwen 默认配置）
pnpm eval:llm --model qwen38_27b --reasoning low --format json_object --concurrency 1

# 单阶段，缩短反馈周期
pnpm eval:llm --model qwen38_27b --phase bidding --concurrency 1

# 消融：关掉叫分启发式建议
pnpm eval:llm --model qwen38_27b --phase bidding --reasoning none --disable-bid-advice --concurrency 1
```

参数：

| 参数 | 说明 |
| --- | --- |
| `--model` | 模型名，默认取 `LLM_MODEL` |
| `--phase` | `bidding`/`trump`/`bury`/`playing`，省略为全阶段 |
| `--reasoning` | `default`/`none`/`low`/`medium`/`high` |
| `--format` | `json_object`/`json_schema`/`text` |
| `--concurrency` | 并发，默认取 `LLM_CONCURRENCY`；串行排查用 `1` |
| `--timeout` | 单请求超时 ms，默认取 `LLM_TIMEOUT_MS` |
| `--disable-bid-advice` | 叫分不带启发锚点，做纯模型对照 |
| `--mock` | **仅开发诊断**，不能作为真实模型成绩 |
| `--output` | 自定义产物根目录，默认 `experiments/results/engine-model-eval` |

耗时与部署、思考档位、排队、重试及预算有关；先用同配置单阶段冒烟估算请求量和总预算。并发提高可能增加排队和长尾，不保证更快；实际 P50/P95 与失败单独报告。

阶段划分与题量：叫分 10、定主 9、扣底 10、出牌 26。

## 5. 跑的时候怎么盯

评测是长时间任务，**必须留日志**，别只靠终端回滚：

```bash
mkdir -p .tmp/eval-checkpoint
pnpm eval:llm --model qwen38_27b --reasoning low --format json_object --concurrency 1 \
  2>&1 | tee .tmp/eval-checkpoint/llm-full.log
```

另开一个终端看进度：

```bash
rg -c '发送决策请求' .tmp/eval-checkpoint/llm-full.log   # 已发起
rg -c 'LLM Response' .tmp/eval-checkpoint/llm-full.log   # 已完成
rg -c 'LLM Error'    .tmp/eval-checkpoint/llm-full.log   # 失败
```

这些文本计数仅提示进度；重试、确定性动作、排队与日志缺失会改变关系，不能直接当作请求量或挂起判据。实际请求/重试以 `modelRequestCount`、`modelRetryCount`、`modelRequests` 和逻辑决策身份为准。

### 故障、回退与策略失误分别判定

按 `scenarioId` 检查未通过记录，核对 `decisionSource`、`errorCode`、是否实际返回动作、原生合法性与回退链。`isNative=false` 也可能是确定性动作、启发式、Mock 或实际回退，不能单凭它判定环境故障。`STRATEGY_MISS` 表示合法动作未达到战术期望，裁判期望本身也可能需要审查。

```bash
node -e '
const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
for(const r of rows.filter(r=>!r.passed))
  console.log(r.scenarioId, "|", r.actionTaken, "|", r.decisionSource, "|", r.errorCode||"-");
' experiments/results/engine-model-eval/<runId>/decisions.ndjson
```

连接失败、超时和没有最终动作的执行错误独立报告；超时长尾包含排队与重试，不只代表模型推理。重跑保留新 run 身份，报告原失败及两次配置/数据/源码差异，不静默用重跑的好成绩替换失败。

曾有 [Qwen 1.4.0 合并诊断](../../experiments/results/engine-model-eval/qwen-v14-full-suite-merged.md)按场景替换失败记录；该文件明确两次 codeHash/dataHash 不同，只能保留为跨 run 诊断，不能当作同指纹的完整基线或与离线表建立排名。

## 6. 配对实战（全生命周期换边对战）

```bash
pnpm exec vite-node scripts/match-battle.ts \
  --engine-a bridge-deep --engine-b bridge-fast --boards 10 --seed 20261001
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--engine-a` / `--engine-b` | `bridge-deep` / `bridge-fast` | 支持 `bridge-fast`、`bridge-deep`、`algorithm-optimized`、`laya` |
| `--boards` | 10 | 发牌组数，每组换边打 2 局，即 `2 × boards` 副 |
| `--seed` | 20261001 | 起始种子，按 `+137 × 组号` 递增 |

10 组 = 20 局，主指标按规则结算的 `winnerSide` 计实际赢副。此 CLI 尚未接入 LLM；产品 P3 已支持模型 profile 模拟，见[模拟说明](../features/simulations.md)。场景通过率不能代替赢副率。

## 7. 产物在哪、怎么看

每个 run 落一个独立目录：`experiments/results/engine-model-eval/<runId>/`，含四个文件。

| 文件 | 用途 |
| --- | --- |
| `report.md` | 人读的 Markdown 战报 |
| `summary.json` | 结构化指标 + 本次覆盖计数 |
| `manifest.json` | `suiteVersion` / `dataHash` / `configHash` / `codeHash` + 配置快照 |
| `decisions.ndjson` | 逐题完整记录，排查靠它 |

排查看 `decisions.ndjson` 的字段：`scenarioId`（哪题）、`inputObservation`（实际可见信息）、`candidates`（候选）、`actionTaken` / `rawResponse`（实际请求与回答）、`details` / `errorCode`（判定与失败分类）、`searchStatusCounts` / `worldsEvaluated`（搜索是否被截断）。

```bash
# 列出某次运行所有未通过的题
rg -o '"scenarioId":"[^"]*","scenarioName":"[^"]*"[^}]*"passed":false' \
  experiments/results/engine-model-eval/<runId>/decisions.ndjson
```

`eval:engines` 和 `match-battle` 还会更新根目录的汇总报告（`cross-engine-comparison.md`、`duplicate-battle-*.md`），更新前把旧报告归档到 `history-*`。

## 8. 指纹：什么时候两次成绩可以比

复用缓存要求 `manifest.json` 的四项全部一致；受控对照允许预先声明的变量变化，其他条件一致，并保留各自指纹：

| 字段 | 含义 |
| --- | --- |
| `suiteVersion` | 裁判与数据协议版本（当前 1.4.0） |
| `dataHash` | 样本定义、输入、候选、描述、构造/判定函数 |
| `configHash` | 实际配置白名单、并发、预算等 |
| `codeHash` | 当前 `src`/`scripts` 全部 TS/TSX + `package.json` + 锁文件 |

`codeHash` **包含未提交修改**，不只看 Git HEAD。所以：

- 跑评测前记录工作区、配置与指纹；未提交实现也参与哈希，不只看 Git HEAD。
- 受控对照预先声明变化的代码/配置；其他条件保持一致。源码或参数意外变化时分别报告，不静默并成同版成绩。
- 旧套件成绩保留旧身份，**不能**和新套件通过率直接比（例如 1.2.0 的 35 题 vs 1.4.0 的 55 题）。

## 9. 收尾自检

改动 `src/`、`tests/`、评测数据或提示词后，交付前至少跑：

```bash
pnpm eval:coverage && pnpm test && pnpm build
```

- 改 `src-tauri/` 另跑：`cargo check --locked --manifest-path src-tauri/Cargo.toml`。
- 涉及 AI 观察投影或采样逻辑的改动，必须留信息隔离回归测试。
- 规则边界测试失败时**不要**放宽断言或删用例。

## 10. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 全阶段跑很久、单题几分钟 | 检查排队、重试、取消、实际预算与模型执行；先单阶段复现，不能仅归因于思考档位 |
| `Connection error` / `TIMEOUT` 集中出现 | 检查服务、网络、预算与取消链；故障独立统计，重跑保留新身份及原失败，不静默合并 |
| P95 接近超时阈值 | 逐条核对超时/排队/重试；延迟与完成/失败率一起报告，不把故障尾延迟当作纯推理耗时 |
| 旧成绩没被复用，提示"与本次数据/配置/源码不一致" | 指纹变了，属预期。要么接受重跑，要么回到旧代码状态 |
| 启动报 node:sqlite | 按启动诊断检查 Node 下限、模块与备份能力，再检查路径/权限；不把所有 SQLite 错误都归因于版本 |
| 想拿真实模型成绩但用了 `--mock` | Mock 只用于开发诊断，**不能**进榜单 |

## 附：命令速查

```bash
# 零成本
pnpm eval:coverage
pnpm typecheck && pnpm test && pnpm build

# 离线
pnpm eval:engines --engine offline --concurrency 1

# 真实模型
pnpm eval:llm --model qwen38_27b --reasoning low --format json_object --concurrency 1

# 对战
pnpm exec vite-node scripts/match-battle.ts --engine-a bridge-deep --engine-b bridge-fast --boards 10 --seed 20261001
```
