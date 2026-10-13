# AI 评测操作手册

本文只讲**怎么跑**：命令、参数、产物位置、跑完怎么看、出问题怎么判。方法与指标口径见[全阶段 AI 引擎与模型评估方案](ai-engine-model-evaluation-plan.md)；样本覆盖见[覆盖补强说明](evaluation-coverage.md)；已出结论见[结果与修复记录](ai-engine-model-evaluation-results.md)。

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
| `LLM_TIMEOUT_MS` | 单次模型请求超时，默认 1200000 ms |
| `LLM_CONCURRENCY` / `LLM_MAX_CONCURRENCY` | 并发上限，保护 GPU 与 vLLM 队列 |
| `LAYA_BASE_URL` / `LAYA_MODEL` / `LAYA_TIMEOUT_MS` | Laya 非自回归引擎 |

**开跑前先探活**，避免跑一半服务掉线（见第 5 节的真实教训）：

```bash
BASE=$(grep '^LLM_BASE_URL=' .env | cut -d= -f2-)
curl -s -m 10 -o /dev/null -w "LLM:%{http_code} in %{time_total}s\n" "$BASE/models" \
  -H "Authorization: Bearer $(grep '^LLM_API_KEY=' .env | cut -d= -f2-)"
```

健康的标准：`HTTP 200` 且响应时间是**几百毫秒**。如果这里就要好几秒，后面 55 题会很慢，先修服务再跑。

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

**耗时预期**：`low` 档单题约 8～120 秒，全 55 题串行约 **60～120 分钟**。并发调高会快，但要和服务方确认显存与队列，不要盲目拉到 8。

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
grep -c '发送决策请求' .tmp/eval-checkpoint/llm-full.log   # 已发起
grep -c 'LLM Response' .tmp/eval-checkpoint/llm-full.log   # 已完成
grep -c 'LLM Error'    .tmp/eval-checkpoint/llm-full.log   # 失败
```

对账口径：**已发起 ≈ 已完成 + 失败**，且「已发起 − 已完成」≤ 并发度。两者长期对不上，就是有请求卡住了。

### 关键教训：服务中途掉线会伪装成"模型很弱"

实测遇到过一次：55 题跑到出牌阶段时服务掉线，尾部 8 题全部失败（6 次 `Connection error` + 2 次撞满超时）。如果直接看总报告，会得到完全错误的结论——

- 出牌阶段看起来是 **17/26（65%）**，实际干净数据是 **25/26（96%）**；
- P95 显示 **1505802 ms**，那其实是超时阈值，不是模型延迟；
- 那 8 题在恢复后重跑**全部达标**。

所以：**看报告第一步永远先数失败题**，把基础设施故障和真实决策失误分开。

```bash
# 从产物里区分：isNative=false 或 errorCode=TIMEOUT 属于环境问题，不是模型能力
node -e '
const rows=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);
for(const r of rows.filter(r=>!r.passed))
  console.log(r.scenarioId, "|", r.actionTaken, "|", r.errorCode||"-", "| native="+r.isNative);
' experiments/results/engine-model-eval/<runId>/decisions.ndjson
```

`STRATEGY_MISS` = 动作合法但没达到战术期望，**这才是真实的模型失误**。

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

10 组 = 20 局，主指标按规则结算的 `winnerSide` 计实际赢副。**LLM 尚未接入对战**，别用场景通过率代替赢副率。

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
grep -o '"scenarioId":"[^"]*","scenarioName":"[^"]*"[^}]*"passed":false' \
  experiments/results/engine-model-eval/<runId>/decisions.ndjson
```

`eval:engines` 和 `match-battle` 还会更新根目录的汇总报告（`cross-engine-comparison.md`、`duplicate-battle-*.md`），更新前把旧报告归档到 `history-*`。

## 8. 指纹：什么时候两次成绩可以比

`manifest.json` 里四项**全部一致**，成绩才可复用/对比：

| 字段 | 含义 |
| --- | --- |
| `suiteVersion` | 裁判与数据协议版本（当前 1.4.0） |
| `dataHash` | 样本定义、输入、候选、描述、构造/判定函数 |
| `configHash` | 实际配置白名单、并发、预算等 |
| `codeHash` | 当前 `src`/`scripts` 全部 TS/TSX + `package.json` + 锁文件 |

`codeHash` **包含未提交修改**，不只看 Git HEAD。所以：

- 跑评测**前**先确认工作区干净（`git status`），否则成绩无法与历史对齐。
- 跑完**别急着改代码再跑下一轮**——中间任何一次保存都会让两次成绩不可比。
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
| 全阶段跑很久、单题几分钟 | `low`/更高的思考档位会产出长思维链；属正常。要快速反馈就先跑单阶段 |
| 报告里出现 `Connection error` / `TIMEOUT` 集中爆发 | 服务端掉线或过载，**不是**模型能力问题。探活确认后单独重跑受影响阶段，按 `scenarioId` 合并 |
| P95 恰好等于超时阈值 | 那一档就是超时，不是真实延迟；看 P50 和失败计数 |
| 旧成绩没被复用，提示"与本次数据/配置/源码不一致" | 指纹变了，属预期。要么接受重跑，要么回到旧代码状态 |
| `pnpm dev` / `pnpm server` 启动报 node:sqlite | Node < 22.16.0，升级 Node |
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
