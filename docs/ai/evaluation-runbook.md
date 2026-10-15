# AI 评测操作手册

评测方法、归因和结论门槛见[统一方案](evaluation-plan.md)。本页维护当前命令与产物位置，不维护历史成绩。

## 环境与免费检查

从仓库根执行，Node/pnpm 版本以 `package.json` 为准。密钥、服务端点和模型配置使用 `.env`，参考 [.env.example](../../.env.example)，不要写进脚本或报告。

```bash
pnpm install --frozen-lockfile
pnpm eval:coverage
pnpm eval:coverage --dataset holdout
pnpm test
pnpm build
```

覆盖审计只读取固定样本并输出统计，不调用模型。开发/保留集位于 `data/evaluation/`，场景数量以本次审计为准。

## 场景评测

```bash
# 单个离线引擎，先用最小范围诊断
pnpm eval:engines --engine bridge-fast --phase bidding --concurrency 1
# 三个离线配置；不调用模型
pnpm eval:engines --engine offline --concurrency 1
# 保留集
pnpm eval:engines --engine bridge-fast --dataset holdout --concurrency 1
```

`--engine` 为单数，可选 `bridge-fast`、`bridge-deep`、`algorithm-optimized`、`laya`、`llm`，支持筛选；`offline` 选择前三项。不传此参数会包含在线引擎，运行前核对范围。`--phase` 支持 `bidding|trump|bury|playing`，不传为全阶段。

真实模型需已授权服务调用并明确预算，先核对服务健康、鉴权和实际模型，再选择最小场景冒烟：

```bash
pnpm eval:llm --phase bidding --reasoning low --format json_object --concurrency 1
```

| 参数 | 说明 |
| --- | --- |
| `--model` | 模型名，默认取 LLM_MODEL |
| `--dataset dev|holdout` / `--holdout` | 数据集，默认开发集 |
| `--reasoning` | default / none / low / medium / high；服务能力另核对 |
| `--format` | json_object / json_schema / text |
| `--timeout` / `--concurrency` | 单请求预算与并发；默认取环境，具体以脚本和 manifest 为准 |
| `--disable-bid-advice` | 关闭叫分建议，用于声明的消融对照 |
| `--mock` | 仅诊断，不能当真实模型成绩 |
| `--output` | LLM 场景输出位置，默认 experiments/results/engine-model-eval |

输入、阶段或指纹不同的结果分别报告。重复实验通过独立运行实现，不虚构 `--repeat` 参数；不要静默用重跑的好成绩替换失败。

## 配对实战

```bash
pnpm exec vite-node scripts/match-battle.ts \
  --engine-a bridge-deep --engine-b bridge-fast --boards 10 --seed 20261001
```

每个发牌组交换双方各打一局，以实际 `winnerSide` 计赢副，发牌组是统计单位。CLI 支持 Bridge fast/deep、Algorithm 与 Laya；LLM profile 的持久模拟使用[产品模拟入口](../features/simulations.md)。固定前置阶段的实验、全生命周期对战和历史分支续打分别报告。

## 输出与排查

默认输出根为 `experiments/results/engine-model-eval/`；每次运行包含独立 run 目录：

| 文件 | 用途 |
| --- | --- |
| report.md / summary.json | 可读报告与结构化指标 |
| manifest.json | 数据、源码、配置与套件指纹 |
| decisions.ndjson | 逐题观察、动作、响应、判定与请求归因 |
| boards.ndjson（对战） | 双局动作、赢家、干预与组级证据 |

横向报告可能更新最近汇总，并把旧汇总写入 `history-*`。这些文件都是忽略的本地产物，按实验需要保留与清理；源码中不提交日志白名单。专项脚本输出与前序依赖见 [experiments](../../experiments/README.md)。

排查按 `scenarioId` / `logicalDecisionId` 核对输入、候选、`decisionSource`、原生合法性、`errorCode`、实际 HTTP 请求/重试和回退链：

- 确定性动作、搜索/启发式、Mock、模型原生、实际回退、无动作执行失败分别统计。
- `isNative=false` 不等于环境故障；合法动作未达到战术期望也不等于非法。
- 超时包含排队和重试，延迟与完成/失败率一起报告；文本日志计数仅用于看进度。
- 未采集的 usage、服务版本和分段耗时写缺失，不填 0；不能用动作数推算 HTTP 次数。

`codeHash` 包含 apps/packages 源码、工作区配置、根脚本与锁文件中的未提交修改，详见[指纹采集](../../scripts/eval-artifacts.ts)。复用缓存要求完整指纹一致；受控对照则事先声明有意变化的变量，保留各自身份。

结果清理前核对运行是否完成、是否仍有读取方和结论引用。需要长期证据时明确保存位置与脱敏范围；清理后移除依赖它的成绩声明。玩家 SQLite 历史不是实验目录，不随输出清理。
