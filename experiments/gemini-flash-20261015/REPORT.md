# Gemini Flash 评测进度（2026-10-15 起）

**未完成：19/55 题取得模型动作；其中 19 题满足当前战术条件，19 题动作合法。**

候选为 gemini-3.8-flash / low。19题从中断前的真实HTTP响应离线恢复判卷，未再次请求；后续逐题保存检查点。未完成题不计策略失败，不以部分通过率冒充全55题成绩。

| 阶段 | 已完成 | 满足条件 | 全套题数 |
| --- | --- | --- | --- |
| bidding | 10 | 10 | 10 |
| trump | 7 | 7 | 9 |
| bury | 2 | 2 | 10 |
| playing | 0 | 0 | 26 |

## 同一已完成子集的历史参考

这不是全套排行榜；子集由配额中断决定，不能据此宣布整体或实战优势。

| 模型 | 思考 | 同一子集通过 | 历史全55题通过 |
| --- | --- | --- | --- |
| qwen38_27b | none | 18/19 | 40/55 |
| qwen35_27b | low | 17/19 | 51/55 |
| qwen35_27b | none | 17/19 | 45/55 |
| qwen38_27b | low | 17/19 | 52/55 |
| qwen38_27b | medium | 17/19 | 51/55 |
| qwen38_27b | xhigh | 16/19 | 46/55 |

## 传输与限流证据

全部HTTP尝试（含探测、重试、未完成题）：84；响应分布 {'200': 20, '503': 4, '429': 59}；缺少终态 1 次，见 audit.json。中断时的在途请求不补造结果。

有效题目的历史尝试合计 38，重试 19；不包含未完成题已有失败。服务可靠性和成本使用全部轨迹，不只用有效检查点。

采集到 20 个usage：输入 23806，completion 1039，total 25512。按返回prompt/completion和公开价估算 $0.021751；思考token计费完整性未确认，非账单。429/503无usage，不能把满额保守预留当实际费用。

初轮SDK只读响应头，忽略Google正文RetryInfo，产生额外429；已停止该编排，原日志保留。续跑串行、发送间隔至少13秒，读取正文RetryInfo与Retry-After中较长等待；日额度耗尽立即停止；暂时503/连接故障最多6次重试。每次HTTP180秒、每次决策600秒。用户授权跑完，不按金额截断。

本账号实际响应：免费层5次/分钟、20次/天。已安排每天北京时间08:05续跑，完成后暂停自动化。日额度按Google项目计算；不自动改计费、模型或密钥。

## 配置与结论边界

产品观察、提示词、bidAdvice与裁判不变，chat/json_object、8192输出token，不发送temperature，关闭回退与Mock。源码和全套数据指纹与Qwen基线一致。不同供应商low不等于相同计算量，思考文字未返回不代表关闭思考。

Qwen并发2、180秒总超时、无重试；Gemini初轮并发2，续跑串行并主动限流，允许6次重试、600秒总超时。原19题耗时为HTTP首entry到成功响应结束的恢复窗口；后续为有效会话执行器耗时。跨日停顿、之前失败会话不并入逐题分位数，不据混合延迟判断纯计算速度。

55题是公开开发集；未做独立保留集或完整牌局换边实验，不宣称实战牌力优势，不更换默认引擎。

## 复现与产物

- 续跑：`pnpm exec vite-node experiments/gemini-flash-20261015/resume.ts`；仅离线恢复：末尾加 `--recover-only`。密钥只读.env。
- 每题检查点：checkpoints/；初轮HTTP日志：results/gemini-3_8-flash-low-r1/transport.ndjson；续跑日志和失败判卷：sessions/。
- 进度与审计：progress.json、audit.json、comparison.json；55题完成后统一报告：results/gemini-3_8-flash-low-resumed/。
- sourceHash：`50e3830d060db48cae9fc9a3634023084a04618af8505154ec59968a0072abd0`；dataHash：`4b7369e1d2c0595e99e07c970042a862fdabe8201f887f774ba6f94c0898536a`。

官方资料：[模型](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)、[兼容API](https://ai.google.dev/gemini-api/docs/openai)、[价格](https://ai.google.dev/gemini-api/docs/pricing)、[限流与重置](https://ai.google.dev/gemini-api/docs/rate-limits)。
