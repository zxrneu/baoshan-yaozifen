"""汇总逐题检查点与全部传输轨迹；未完成集不进入55题排行榜。"""
from pathlib import Path
from collections import Counter
import hashlib
import json

root = Path(__file__).resolve().parent
progress = json.loads((root/'progress.json').read_text())
checkpoints = [json.loads(p.read_text()) for p in sorted((root/'checkpoints').glob('*.json'))]
results = [c['result'] for c in checkpoints]
ids = {r['scenarioId'] for r in results}
assert len(ids) == len(results) == progress['completed']
assert all(c['codeHash'] == progress['codeHash'] and c['fullDataHash'] == progress['dataHash'] for c in checkpoints)
logs = [root/'results/gemini-3_8-flash-low-r1/transport.ndjson', *sorted((root/'sessions').glob('*/transport.ndjson'))]
events = []
for file in logs:
    for line in file.read_text().splitlines():
        event = json.loads(line); event['journal'] = str(file.relative_to(root)); events.append(event)
requests = [e for e in events if e['event']=='request']
responses = [e for e in events if e['event']=='response']
terminal_keys = {(e['journal'], e['id']) for e in events if e['event'] in ('response','error')}
missing = [{'journal':e['journal'],'id':e['id']} for e in requests if (e['journal'],e['id']) not in terminal_keys]
usage = [e.get('usage') or (e['response'].get('usage') if isinstance(e.get('response'),dict) else None) for e in responses]
usage = [u for u in usage if u]
daily = [e for e in responses if e['status']==429 and 'PerDay' in json.dumps(e.get('response'))]
completed_transports = sum(r['modelRequestCount'] or 0 for r in results)
audit = {'completed':len(results),'planned':55,'allHttpAttemptsIncludingProbeAndAbandoned':len(requests),
         'allHttpStatus':dict(Counter(str(e['status']) for e in responses)),
         'terminalRecords':len(terminal_keys),'missingTerminalEvidence':missing,
         'completedDecisionsHistoricalAttempts':completed_transports,
         'completedDecisionsHistoricalRetries':sum(r['modelRetryCount'] or 0 for r in results),
         'successfulResponsesIncludingProbe':sum(e['status']==200 for e in responses),
         'usageCoverage':len(usage),'reportedPromptTokens':sum(u.get('prompt_tokens',0) for u in usage),
         'reportedCompletionTokens':sum(u.get('completion_tokens',0) for u in usage),
         'reportedTotalTokens':sum(u.get('total_tokens',0) for u in usage),
         'usageEstimateUsd':sum(u.get('prompt_tokens',0)*.75/1e6+u.get('completion_tokens',0)*3.75/1e6 for u in usage),
         'lastDailyQuotaResponse':daily[-1] if daily else None,
         'codeHash':progress['codeHash'],'dataHash':progress['dataHash'],
         'resumeScriptSha256':hashlib.sha256((root/'resume.ts').read_bytes()).hexdigest(),
         'automation':{'id':'gemini-flash','schedule':'每天北京时间08:05','status':'ACTIVE，完成后暂停'},
         'limitations':['有效检查点只代表已取得模型动作的子集；全部失败与未完成题另列',
                        '历史19题恢复耗时为HTTP轨迹窗口，后续为有效会话执行器耗时；不含跨日停顿',
                        'usage未单独提供思考token时，公开价估算不能当完整账单']}
baselines = []
for file in sorted((root.parent/'model-sweep-20261015/results').glob('*/summary.json')):
    s = json.loads(file.read_text())
    if s.get('status')=='skipped': continue
    assert s['codeHash']==progress['codeHash'] and s['dataHash']==progress['dataHash']
    subset = [r for r in s['scenarioResults'] if r['scenarioId'] in ids]
    baselines.append({'id':s['runId'],'model':s['modelName'],'effort':s['engineConfigSnapshot']['reasoningEffort'],
                      'sameSubsetPassed':sum(r['passed'] for r in subset),'sameSubsetCount':len(subset),
                      'fullPassed':s['passedCount'],'p50Seconds':s['p50LatencyMs']/1000,'p95Seconds':s['p95LatencyMs']/1000})
(root/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
(root/'comparison.json').write_text(json.dumps(baselines,ensure_ascii=False,indent=2)+'\n')
done = len(results)==55
lines = ['# Gemini Flash 评测进度（2026-10-15 起）','',
         f"**{'已完成' if done else '未完成'}：{len(results)}/55 题取得模型动作；其中 {sum(r['passed'] for r in results)} 题满足当前战术条件，{sum(r['isLegal'] for r in results)} 题动作合法。**",'',
         '候选为 gemini-3.8-flash / low。19题从中断前的真实HTTP响应离线恢复判卷，未再次请求；后续逐题保存检查点。未完成题不计策略失败，不以部分通过率冒充全55题成绩。','',
         '| 阶段 | 已完成 | 满足条件 | 全套题数 |','| --- | --- | --- | --- |']
for p,n in [('bidding',10),('trump',9),('bury',10),('playing',26)]:
    group = [r for r in results if r['phase']==p]
    lines.append(f"| {p} | {len(group)} | {sum(r['passed'] for r in group)} | {n} |")
lines += ['','## 同一已完成子集的历史参考','','这不是全套排行榜；子集由配额中断决定，不能据此宣布整体或实战优势。','',
          '| 模型 | 思考 | 同一子集通过 | 历史全55题通过 |','| --- | --- | --- | --- |']
for b in sorted(baselines,key=lambda b:-b['sameSubsetPassed']):
    lines.append(f"| {b['model']} | {b['effort']} | {b['sameSubsetPassed']}/{b['sameSubsetCount']} | {b['fullPassed']}/55 |")
lines += ['','## 传输与限流证据','',
          f"全部HTTP尝试（含探测、重试、未完成题）：{len(requests)}；响应分布 {audit['allHttpStatus']}；缺少终态 {len(missing)} 次，见 audit.json。中断时的在途请求不补造结果。",'',
          f"有效题目的历史尝试合计 {completed_transports}，重试 {audit['completedDecisionsHistoricalRetries']}；不包含未完成题已有失败。服务可靠性和成本使用全部轨迹，不只用有效检查点。",'',
          f"采集到 {len(usage)} 个usage：输入 {audit['reportedPromptTokens']}，completion {audit['reportedCompletionTokens']}，total {audit['reportedTotalTokens']}。按返回prompt/completion和公开价估算 ${audit['usageEstimateUsd']:.6f}；思考token计费完整性未确认，非账单。429/503无usage，不能把满额保守预留当实际费用。",'',
          '初轮SDK只读响应头，忽略Google正文RetryInfo，产生额外429；已停止该编排，原日志保留。续跑串行、发送间隔至少13秒，读取正文RetryInfo与Retry-After中较长等待；日额度耗尽立即停止；暂时503/连接故障最多6次重试。每次HTTP180秒、每次决策600秒。用户授权跑完，不按金额截断。', '',
          '本账号实际响应：免费层5次/分钟、20次/天。已安排每天北京时间08:05续跑，完成后暂停自动化。日额度按Google项目计算；不自动改计费、模型或密钥。','',
          '## 配置与结论边界','',
          '产品观察、提示词、bidAdvice与裁判不变，chat/json_object、8192输出token，不发送temperature，关闭回退与Mock。源码和全套数据指纹与Qwen基线一致。不同供应商low不等于相同计算量，思考文字未返回不代表关闭思考。', '',
          'Qwen并发2、180秒总超时、无重试；Gemini初轮并发2，续跑串行并主动限流，允许6次重试、600秒总超时。原19题耗时为HTTP首entry到成功响应结束的恢复窗口；后续为有效会话执行器耗时。跨日停顿、之前失败会话不并入逐题分位数，不据混合延迟判断纯计算速度。', '',
          '55题是公开开发集；未做独立保留集或完整牌局换边实验，不宣称实战牌力优势，不更换默认引擎。', '',
          '## 复现与产物','',
          '- 续跑：`pnpm exec vite-node experiments/gemini-flash-20261015/resume.ts`；仅离线恢复：末尾加 `--recover-only`。密钥只读.env。',
          '- 每题检查点：checkpoints/；初轮HTTP日志：results/gemini-3_8-flash-low-r1/transport.ndjson；续跑日志和失败判卷：sessions/。',
          '- 进度与审计：progress.json、audit.json、comparison.json；55题完成后统一报告：results/gemini-3_8-flash-low-resumed/。',
          f"- sourceHash：`{progress['codeHash']}`；dataHash：`{progress['dataHash']}`。",'',
          '官方资料：[模型](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)、[兼容API](https://ai.google.dev/gemini-api/docs/openai)、[价格](https://ai.google.dev/gemini-api/docs/pricing)、[限流与重置](https://ai.google.dev/gemini-api/docs/rate-limits)。']
(root/'REPORT.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({k:audit[k] for k in ['completed','allHttpAttemptsIncludingProbeAndAbandoned','allHttpStatus','missingTerminalEvidence']},ensure_ascii=False))
