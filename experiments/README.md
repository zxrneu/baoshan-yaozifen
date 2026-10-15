# 独立实验

这里保存实验代码，和常规 `pnpm test` 分开。通用评测优先使用根 `scripts/` 与 `packages/ai-eval/`，方法和命令见[评测手册](../docs/ai/evaluation-runbook.md)。

## 保留内容

- `harness.ts`、`*.test.ts`、`vitest.config.ts`：离线策略、搜索与耗时实验。
- 日期目录中的 TS/Python 脚本：专项运行、恢复与汇总逻辑；它们可能依赖前序运行生成的输入，不能直接续跑已清理的历史任务。
- `gemini-flash-20261015/resume-support.ts`：有限流和检查点保护回归，不随结果清理删除。

固定样本放在 `data/evaluation/`。JSON/NDJSON、请求响应、检查点、报告、一次性计划及中间统计均为本地产物，不提交；规则见 [.gitignore](.gitignore)。通用实验写入 `results/`，目录内保留忽略规则，确保新检出环境也有输出目录。

## 运行

```bash
# 先审查实验的模型调用、预算与默认轮数，再选择具体用例
pnpm exec vitest run --config experiments/vitest.config.ts experiments/bench.test.ts
```

专项脚本不属于常规 CI。使用前核对参数、源码路径、环境变量和所需前序文件；先按最小预算验证。真实模型调用需有用户授权，普通清理或文档维护不触发实验。

需要结论时保留当次完整证据到约定位置，再审查数据/配置/源码指纹、故障和适用范围。仓库不保留历史成绩榜；清理结果时同步移除依赖它的结论和链接。
