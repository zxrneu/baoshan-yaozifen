# 模型与思考档位对照计划（2026-10-15）

问题：两个自部署 Qwen 和 Radeon 文本模型在同一公开场景下的战术质量、合法性与服务延迟如何。

固定：公开开发套件 1.4.0 全阶段 55 题、现有提示词、叫分建议开启、chat/json_object、max_tokens=8192、单端点并发 2、单次超时 180000 ms、SDK 重试 0、关闭 Mock 和启发式回退。普通玩家可见观察；既有隔离与归因测试先通过。不同服务可同时运行，端点内各档位依次运行；延迟包含共享服务排队，不能解释为纯权重速度。

自部署：qwen35_27b 的 none/low/medium/high；qwen38_27b 的 none/low/medium/xhigh（该服务明确拒绝 high，返回支持 xhigh/medium/low，none 探测成功）。xhigh 仅在实验传输适配器中设置，不更改产品枚举。每配置一轮全 55 题；相同公开题不构成独立泛化集。

Radeon：先读取模型清单，跳过仅 OCR 的 MinerU；其余 11 个文本模型。网页截图和实际 /models 不一致，以当次接口 ID 为准。该接口返回 free=false 和单价，实际调用等待用户预算确认。首轮 low（若被明确拒绝则单列并在 default 配置重测），不把无证据的参数接收等同思考控制有效。

预计自部署 440 次决策（唯一候选可减少 HTTP 数）；Radeon 605 次决策。预算上限按 API 返回的 prompt/completion token 单价和 max_tokens 在发请求前预留，实际 usage 在响应后结算；记录 pricing 原始单位，不能确认实际账单币种。探测、失败与重试另外列出，不静默丢弃。保留原始响应/usage/finish_reason/思考长度、manifest 和逐题决策。服务真实权重/量化/硬件未知。

通过率只用于公开单步战术诊断；原生成功与最终合法率单列。没有独立种子整副牌换边实战，不宣称实际牌力提升或更改默认引擎。对于领先配置，若差距较小须做独立重复，仍不能代替未参与调参的确认集。

更新：用户明确要求 Radeon 先不测；本轮仅有只读模型清单请求，无 Radeon 推理调用。Radeon 原定实验取消。

方案修订（模板探测后、medium/high全套运行前）：local35的low/medium/high输入token完全相同，因此medium/high不再完整重复，保留status=skipped的无分数记录，并以low的全55题作为开启思考基线。local38继续none/low/medium/xhigh四组全55题。预计有效决策330次，另含参数探测。不得把跳过记录计为实跑或复用得分。
