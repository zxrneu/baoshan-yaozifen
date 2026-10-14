# Prompt 2.0 专项评测（2026-10-12）

方法、变更与结论见[优化记录](../../../../docs/ai/llm-prompt-optimization.md)。固定套件1.2.0、Qwen部署别名、chat/json_object、none、30秒超时、并发1、保留bidAdvice；最终比较两版35个相同输入，每场景各一次。

| 运行 | 用途 | 通过数 | 回退数 | 报告 / 配置 / 原始日志 |
| --- | --- | --- | --- | --- |
| `run-1791791610793-qwen38_27b` | 原提示词，8个叫分初测 | 5/8 | 0 | [报告](run-1791791610793-qwen38_27b/report.md) / [manifest](run-1791791610793-qwen38_27b/manifest.json) / [决策](run-1791791610793-qwen38_27b/decisions.ndjson) |
| `run-1791791953508-qwen38_27b` | 初稿，8个叫分 | 6/8 | 0 | [报告](run-1791791953508-qwen38_27b/report.md) / [manifest](run-1791791953508-qwen38_27b/manifest.json) / [决策](run-1791791953508-qwen38_27b/decisions.ndjson) |
| `run-1791792141276-qwen38_27b` | 修订一，35场景 | 25/35 | 0 | [报告](run-1791792141276-qwen38_27b/report.md) / [manifest](run-1791792141276-qwen38_27b/manifest.json) / [决策](run-1791792141276-qwen38_27b/decisions.ndjson) |
| `run-1791792478689-qwen38_27b` | 最终版本，35场景 | 26/35 | 0 | [报告](run-1791792478689-qwen38_27b/report.md) / [manifest](run-1791792478689-qwen38_27b/manifest.json) / [决策](run-1791792478689-qwen38_27b/decisions.ndjson) |
| `legacy-1791792714171-qwen38_27b` | 原提示词，全阶段对照 | 22/35 | 1 | [报告](legacy-1791792714171-qwen38_27b/report.md) / [manifest](legacy-1791792714171-qwen38_27b/manifest.json) / [决策](legacy-1791792714171-qwen38_27b/decisions.ndjson) |

[逐场景对照](comparison.json)保存改善和回退样例；[请求字符数](request-size-comparison.json)记录35场景的system/user长度，字符数不是token usage。

全阶段基线通过独立进程加载`c2819c8`的原构造器，保持当前传输和裁判一致；其`codeHash`对应当前公共实现，`configHash`另外包含`promptVariant`和原源码`promptSourceHash`。未替换工作区代码，也未把原提示词成绩标成新版成绩。

保留[原源码](baseline-llmPrompts.ts.txt)、[对照脚本](baseline-evaluation-harness.ts.txt)、[独立模块](baseline-builder-module.ts.txt)以追溯对照方法。脚本在评测时作为项目根目录临时文件运行；路径与临时输出目录需按运行环境设置，认证信息只来自环境配置。

[新版源码快照](final-llmPrompts.ts.txt)固定本次提示词内容。两版正式对照的codeHash相同；收尾的其他扣底修改导致工作区整体指纹变化，但35份当前提示词均与新版实测请求逐条一致。comparison.json分别保存evaluatedCodeHash、workspaceCodeHashAtVerification及两份提示词源码指纹，旧manifest保持原样。

阶段/总通过率包括最终采用的回退动作；基线的一次扣底非法牌回退已单列。两版最终合法率均100%，新版零回退。中间运行仅记录迭代，不并入最终样本量，也不选择其最好成绩代表最终版。

这些是单步、单次、none档诊断；不能推出模型整体牌力、默认low档速度或稳定优势。主评测矩阵的离线成绩未重跑，不与本目录模型成绩拼接排名。
