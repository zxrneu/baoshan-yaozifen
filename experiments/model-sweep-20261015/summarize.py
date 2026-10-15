"""汇总独立运行及真实传输证据；公开场景成绩与整副牌结论保持边界。"""
from pathlib import Path
from collections import Counter
import json
import statistics

ROOT = Path(__file__).resolve().parent
rows = []
skipped = []
for file in sorted((ROOT / 'results').glob('*/summary.json')):
    s = json.loads(file.read_text())
    if s.get('status') == 'skipped':
        skipped.append(s)
        continue
    requests = [json.loads(line) for line in (file.parent / 'transport.ndjson').read_text().splitlines()]
    responses = [r for r in requests if 'status' in r]
    native_passed = sum(r['passed'] and r['decisionSource'] == 'model' for r in s['scenarioResults'])
    row = {
        'id': s['runId'], 'model': s['modelName'], 'provider': s['engineConfigSnapshot']['provider'],
        'effort': s['engineConfigSnapshot']['reasoningEffort'],
        'repeat': s['engineConfigSnapshot']['repeat'],
        'passed': s['passedCount'], 'total': s['totalScenarios'],
        'nativePassed': native_passed, 'nativeSuccess': s['nativeSuccessCount'],
        'legal': s['legalCount'], 'failures': s['executionFailureCount'],
        'fallback': s['fallbackCount'], 'mock': s['mockCount'],
        'p50Sec': s['p50LatencyMs'] / 1000, 'p95Sec': s['p95LatencyMs'] / 1000,
        'macroScore': s['phaseMacroAverageScore'],
        'httpCalls': s['actualModelCalls'], 'httpRetries': s['actualModelRetries'],
        'transportTerminalRecords': len(requests),
        'missingTransportTerminalRecords': s['actualModelCalls'] - len(requests),
        'phases': {p: f"{v['passed']}/{v['total']}" for p, v in s['phaseSummaries'].items()},
        'httpStatus': dict(Counter(str(r['status']) for r in responses)),
        'finish': dict(Counter(str(r.get('finish')) for r in responses)),
        'emptyContent': sum(r.get('contentChars', 0) == 0 for r in responses),
        'reasoningResponses': sum(r.get('reasoningChars', 0) > 0 for r in responses),
        'medianReasoningChars': statistics.median([r.get('reasoningChars', 0) for r in responses]) if responses else None,
        'usageAvailable': sum(r.get('usage') is not None for r in responses),
        'tokenCountsArePartial': sum(r.get('usage') is not None for r in responses) != s['actualModelCalls'],
        'promptTokens': sum((r.get('usage') or {}).get('prompt_tokens', 0) for r in responses),
        'completionTokens': sum((r.get('usage') or {}).get('completion_tokens', 0) for r in responses),
        'estimatedApiPriceUnits': sum(r.get('actualCost') or 0 for r in responses) if s['engineConfigSnapshot']['provider'] == 'radeon' else None,
    }
    rows.append(row)

rows.sort(key=lambda r: (-r['passed'], r['failures'], r['p95Sec']))
(ROOT / 'comparison.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
lines = ['# 模型与思考档位实测（2026-10-15）', '',
         '统一公开开发套件 1.4.0，四阶段 55 题，每配置独立一轮。当前报告只汇总已完成的 run，未完成批次不计入排行。', '',
         '服务映射：local35 = :6091 / qwen35_27b；local38 = :6195 / qwen38_27b。IP与鉴权头不进入报告。', '',
         '固定 chat/json_object、max_tokens=8192、每端点并发2、请求超时180秒、重试0、叫分建议开启、Mock和回退关闭。不同端点同时运行；延迟受各服务资源和排队影响。', '',
         '沿用产品客户端：显式设置reasoning_effort时不发送temperature，实际温度/top_p/随机种子采用各服务默认值（未采集）。这是当前部署的对照，不是固定量化、硬件和采样参数后的纯权重比较。', '',
         '| 服务 / 模型 | 档位 / 轮次 | 通过 | 合法 | 原生成功 | 执行失败 | P50秒 | P95秒 | 阶段宏均分 |',
         '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
for r in rows:
    lines.append(f"| {r['provider']} / {r['model']} | {r['effort']} / {r['repeat']} | {r['passed']}/{r['total']} ({100*r['passed']/r['total']:.1f}%) | {r['legal']}/{r['total']} | {r['nativeSuccess']}/{r['total']} | {r['failures']} | {r['p50Sec']:.2f} | {r['p95Sec']:.2f} | {r['macroScore']} |")
lines += ['', '## 四阶段分布', '', '| 配置 | 叫分 | 定主 | 扣底 | 出牌 |', '| --- | --- | --- | --- | --- |']
for r in rows:
    p = r['phases']
    lines.append(f"| {r['id']} | {p['bidding']} | {p['trump']} | {p['bury']} | {p['playing']} |")
lines += ['', '## 传输与思考控制', '',
          '| 配置 | HTTP请求/重试 | finish_reason | 空content | 含思考响应 | 思考字符中位数 | 已采集输出tokens / usage覆盖 |',
          '| --- | --- | --- | --- | --- | --- | --- |']
for r in rows:
    lines.append(f"| {r['id']} | {r['httpCalls']}/{r['httpRetries']} | {r['finish']} | {r['emptyContent']} | {r['reasoningResponses']} | {r['medianReasoningChars']} | {r['completionTokens']} / {r['usageAvailable']}/{r['httpCalls']} |")
lines += ['', '请求次数是SDK fetch边界记录的传输尝试，不表示已证明每次均到达服务端。原始底层终态记录的覆盖如下；不补造缺失记录。', '']
for r in rows:
    lines.append(f"- {r['id']}：SDK尝试{r['httpCalls']}次，底层终态{r['transportTerminalRecords']}条，缺失{r['missingTransportTerminalRecords']}条。")
lines += ['', 'xhigh的两次Connection error保留在统一裁判的失败列表，缺失底层终态记录与底层异常cause，根因未采集；不能认定为模型策略错误。另有5次明确的180秒TIMEOUT。没有为补全轨迹额外重测或丢弃这些失败。', '']
lines += ['', '## 同题开关对照', '',
          '以下是同一公开题集的一次配对运行，不是独立发牌的实战样本。', '',
          '| 服务 | 开启档位 | 关闭失败→开启通过 | 关闭通过→开启失败 | 总通过数变化 | P50延迟倍数 |',
          '| --- | --- | --- | --- | --- | --- |']
for r in rows:
    if r['effort'] == 'none':
        continue
    base = next((b for b in rows if b['provider'] == r['provider'] and b['model'] == r['model'] and b['effort'] == 'none' and b['repeat'] == r['repeat']), None)
    if base is None:
        continue
    current = json.loads((ROOT / 'results' / r['id'] / 'summary.json').read_text())
    previous = json.loads((ROOT / 'results' / base['id'] / 'summary.json').read_text())
    before = {d['scenarioId']: d['passed'] for d in previous['scenarioResults']}
    gained = sum(d['passed'] and not before[d['scenarioId']] for d in current['scenarioResults'])
    lost = sum(not d['passed'] and before[d['scenarioId']] for d in current['scenarioResults'])
    lines.append(f"| {r['provider']} | {r['effort']} | {gained} | {lost} | {r['passed']-base['passed']:+d} | {r['p50Sec']/base['p50Sec']:.1f}倍 |")
lines += ['', '## 未通过的逐题证据', '']
for r in rows:
    s = json.loads((ROOT / 'results' / r['id'] / 'summary.json').read_text())
    lines += [f"### {r['id']}", '']
    for d in s['scenarioResults']:
        if not d['passed']:
            lines.append(f"- `{d['scenarioId']}`：{d['actionTaken']}；{d.get('errorCode', '')}；期望 {d['optimalActionDesc']}")
    lines.append('')
lines += ['## 跳过的等价参数组', '']
for s in skipped:
    lines.append(f"- {s['provider']} / {s['model']} / {s['effort']}：{s['reason']}")
lines += ['', '## 结论边界与复现', '',
          '55题是公开开发集，单次差1~2题不足以可靠判断优势；同题重复也不是独立泛化确认。这里没有整副牌配对换边赢副率证据，不能据此宣称哪个模型实战牌力更强。模型别名不证明真实权重、量化与硬件相同。', '',
          'qwen38服务拒绝high，支持xhigh；实验只在传输适配器中把对应字段改成xhigh，manifest记录实际发送值。该组decisions/summary中的requestPayload是SDK改写前的high快照，不能当作线上实际请求体；线上请求以transport.ndjson里的request.reasoning_effort=xhigh为准，两份证据均保留。', '',
          '已用tokenize的chat_template_kwargs显式传入enable_thinking/reasoning_effort验证：local35的low/medium/high产生完全相同的23个token（SHA256一致），none为25个token；local38的low/medium/xhigh分别为53/23/65个token，none为25个token。裸传reasoning_effort的tokenize接口忽略了该字段，不能用早先裸字段探测判断模板语义。原始证据见template-probes.json。', '',
          '因此local35以low的全55题作为“思考开启”基线，medium/high探测后标记跳过，不生成或复用虚构分数。[Qwen3.5官方模板](https://huggingface.co/Qwen/Qwen3.5-27B/blob/main/chat_template.jinja)只处理enable_thinking；[Qwen3.8官方模板](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/chat_template.jinja)分别给low和xhigh注入不同指令，medium不注入额外思考指令。模板长度变化不证明真实权重版本，实际chat响应仍用于验证有无思考输出。', '',
          '实测local35为vLLM 0.26.0，local38为vLLM 0.28.0。Radeon仅查询模型清单，用户取消后未发送推理请求。', '',
          'max_tokens上限同时约束思考及最终文本；finish_reason=length、空content及失败均保留，不能把预算不足当作纯策略能力问题。无fallback/Mock时的合法率包含执行失败，原生成功表示模型动作成功而非战术通过。', '',
          '每个已完成run保留summary.json、manifest.json、report.md、decisions.ndjson、transport.ndjson、timing.json。transport成功响应记录含真实请求体、原始响应、usage、finish_reason和思考长度；超时异常记录仅有时间、耗时和错误，未捕获该次完整请求体，也没有响应/usage。不保存鉴权头。token数仅汇总已采集usage，并标注覆盖率，未知量不视为零。端点以local35/local38/radeon标识。', '',
          '```bash', 'pnpm exec vite-node experiments/model-sweep-20261015/run.ts local',
          '# Radeon 仅在用户确认预算后，以SWEEP_RADEON_BUDGET设置上限运行radeon模式',
          'python3 experiments/model-sweep-20261015/summarize.py', '```', '']
(ROOT / 'COMPARISON.md').write_text('\n'.join(lines))
verdict = ROOT / 'VERDICT.md'
if verdict.exists():
    body = (ROOT / 'COMPARISON.md').read_text()
    title, rest = body.split('\n', 1)
    (ROOT / 'COMPARISON.md').write_text(title + '\n\n' + verdict.read_text().strip() + '\n' + rest)
print(f'已汇总 {len(rows)} 个已完成配置')
