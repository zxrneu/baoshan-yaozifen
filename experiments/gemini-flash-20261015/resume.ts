/** Gemini 评测断点编排；复用统一裁判，逐题保留模型证据，网络限流与离线恢复分离。 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { OpenAiSdkClient, type ILlmClient, type LlmCompletionRequest } from '@yaozifen/ai-core/engines/llm/llmClient';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { scenarioCoverage } from '@yaozifen/ai-eval/coverage';
import type { BenchmarkReportSummary, ScenarioRunResult, EvalPhase } from '@yaozifen/ai-eval/types';
import { evaluationSourceHash, saveEvaluationRun } from '../../scripts/eval-artifacts';
import { googleRetryPolicy, saveCheckpoint, type RetryPolicy } from './resume-support';

const root = path.resolve('experiments/gemini-flash-20261015');
const checkpoints = path.join(root, 'checkpoints');
const offline = process.argv.includes('--recover-only');
const model = 'gemini-3.8-flash';
const endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
const log = console.log.bind(console);
console.log = () => {}; console.error = () => {}; console.warn = () => {};
const codeHash = await evaluationSourceHash();
const initialConfig = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')) as { codeHash: string };
const baseline = JSON.parse(fs.readFileSync('experiments/model-sweep-20261015/results/local38-qwen38_27b-low-r1/summary.json', 'utf8')) as BenchmarkReportSummary;
if (codeHash !== initialConfig.codeHash || codeHash !== baseline.codeHash) throw new Error('源码已变，拒绝混合历史结果');
const runner = new BenchmarkRunner();
const baseOptions = { baseUrl: endpoint, model, protocol: 'chat' as const, responseFormat: 'json_object' as const,
  reasoningEffort: 'low' as const, maxTokens: 8192, timeoutMs: 600000, maxRetries: 6, maxConcurrency: 1,
  enableDevMockOnFailure: false, enableFallbackOnFailure: false, disableBidAdvice: false };
const configEngine = new LlmEngine(baseOptions);
const identity = await runner.describeRun(configEngine, ALL_BENCHMARK_SCENARIOS, { modelName: model, concurrency: 1, codeHash,
  engineConfig: { provider: 'google-gemini', experiment: 'gemini-flash-20261015', resumed: true,
    pacingMs: 13000, latencyProtocol: 'active-final-session; initial-recovery-http-window', dailyQuotaStop: true } });
if (identity.dataHash !== baseline.dataHash) throw new Error('数据已变，拒绝混合同题成绩');
interface Checkpoint { result: ScenarioRunResult; codeHash: string; fullDataHash: string; evidence: unknown; latencyMethod: string }
function load(): Map<string, Checkpoint> {
  const map = new Map<string, Checkpoint>();
  if (!fs.existsSync(checkpoints)) return map;
  for (const file of fs.readdirSync(checkpoints).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(fs.readFileSync(path.join(checkpoints, file), 'utf8')) as Checkpoint;
    if (c.codeHash !== codeHash || c.fullDataHash !== identity.dataHash) throw new Error('检查点指纹不符');
    map.set(c.result.scenarioId, c);
  }
  return map;
}
const journal = path.join(root, 'results/gemini-3_8-flash-low-r1/transport.ndjson');
interface OriginalEvent { event: string; id: number; phase?: string; at?: string; ms?: number;
  request?: { messages: unknown }; status?: number; response?: { choices?: Array<{ message: { content?: string } }> } }
const old = fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s) as OriginalEvent);
const requestById = new Map(old.filter(e => e.event === 'request').map(e => [e.id, e]));
const entryById = new Map(old.filter(e => e.event === 'entry').map(e => [e.id, e]));
const messageKey = (messages: unknown) => JSON.stringify(messages);
const scenarioByMessage = new Map(baseline.scenarioResults.map(r => {
  const raw = r.rawResponse as { requestPayload: { messages: unknown } };
  return [messageKey(raw.requestPayload.messages), r.scenarioId];
}));
const recovered: string[] = [];
let completed = load();
for (const response of old.filter(e => e.event === 'response' && e.phase === 'suite' && e.status === 200)) {
  const request = requestById.get(response.id)!;
  const key = messageKey(request.request!.messages);
  const scenarioId = scenarioByMessage.get(key);
  if (!scenarioId) throw new Error('历史请求无法匹配本题集，拒绝猜测');
  if (completed.has(scenarioId)) continue;
  const scenario = ALL_BENCHMARK_SCENARIOS.find(s => s.id === scenarioId)!;
  const text = response.response?.choices?.[0].message.content;
  if (!text) throw new Error('历史成功响应无文本');
  const client: ILlmClient = { supportsModelRequestTelemetry: false, async complete(actual) {
    if (messageKey(actual.messages) !== key) throw new Error('恢复提示词不一致');
    return { rawText: text, requestBody: request.request, latencyMs: 0 };
  } };
  const summary = await runner.runSuite(new LlmEngine({ ...baseOptions, client }), [scenario], {
    runId: `recover-${scenarioId}`, modelName: model, concurrency: 1, codeHash });
  const result = summary.scenarioResults[0];
  // 恢复的请求计数直接来自历史真实发送点；不是这次离线判卷新发起了请求。
  const attempts = old.filter(e => e.event === 'request' && e.phase === 'suite' && messageKey(e.request?.messages) === key && e.id <= response.id);
  result.modelRequestCount = attempts.length; result.modelRetryCount = Math.max(0, attempts.length - 1);
  result.modelRequests = attempts.map((_, i) => ({ attempt: i + 1 })); result.isNative = attempts.length > 0;
  const first = entryById.get(attempts[0].id)!;
  const last = entryById.get(response.id)!;
  result.latencyMs = Date.parse(last.at!) + response.ms! - Date.parse(first.at!);
  const checkpoint: Checkpoint = { result, codeHash, fullDataHash: identity.dataHash,
    evidence: { journal: path.relative(root, journal), ids: attempts.map(e => e.id), responseId: response.id, offlineAdjudication: true },
    latencyMethod: '历史首个 HTTP entry 到成功响应结束，非原执行器精确耗时；含其中重试等待' };
  saveCheckpoint(checkpoints, scenarioId, checkpoint); recovered.push(scenarioId);
  completed = load();
}
if (recovered.length) fs.writeFileSync(path.join(root, 'recovery.json'), JSON.stringify({ recovered,
  note: '仅对真实响应离线重判；未发起 API。全部原请求和失败保留在原 journal；未完成题不会伪造评分。' }, null, 2));

const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
const sessionDir = path.join(root, 'sessions', sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
const append = (value: unknown) => fs.appendFileSync(path.join(sessionDir, 'transport.ndjson'), JSON.stringify(value) + '\n');
let quota: RetryPolicy = { daily: false, retryDelayMs: 0 };
let activeScenario = ''; let sequence = 0; let nextSendAt = 0; let nextRetryMs = 0;
let currentRequestIds: number[] = [];
const envLine = fs.readFileSync('.env', 'utf8').split('\n').find(s => s.trim().startsWith('GEMINI_KEY='));
const apiKey = envLine?.slice(envLine.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
if (!apiKey && !offline) throw new Error('GEMINI_KEY 缺失');
const fetchFn: typeof fetch = async (url, init) => {
  const id = ++sequence; currentRequestIds.push(id); const at = Date.now();
  const body = JSON.parse(String(init?.body)) as unknown;
  append({ event: 'request', id, scenarioId: activeScenario, at: new Date(at).toISOString(), request: body });
  try {
    const response = await fetch(url, init); const raw = await response.clone().text();
    let parsed: unknown = raw; try { parsed = JSON.parse(raw); } catch { /* 原样保留。 */ }
    quota = googleRetryPolicy(parsed, response.headers);
    nextRetryMs = quota.retryDelayMs;
    append({ event: 'response', id, scenarioId: activeScenario, at: new Date().toISOString(), ms: Date.now() - at,
      status: response.status, response: parsed, retryPolicy: quota });
    return response;
  } catch (error) {
    append({ event: 'error', id, scenarioId: activeScenario, ms: Date.now() - at,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error) }); throw error;
  }
};
const sdk = new OpenAiSdkClient({ baseUrl: endpoint, apiKey, timeoutMs: 180000, maxRetries: 0, fetchFn });
const client: ILlmClient = { supportsModelRequestTelemetry: true, async complete(request: LlmCompletionRequest) {
  let attempt = 0;
  for (let retry = 0; ; retry++) {
    if (quota.daily) throw new Error('日配额已耗尽，停止本次续跑');
    const waitMs = Math.max(0, nextSendAt - Date.now(), retry > 0 ? nextRetryMs || Math.min(60000, 2000 * 2 ** (retry - 1)) : 0);
    if (waitMs) await delay(waitMs, undefined, { signal: request.signal });
    nextSendAt = Date.now() + 13000; nextRetryMs = 0;
    try { return await sdk.complete({ ...request, onModelRequest: () => request.onModelRequest?.({ attempt: ++attempt }) }); }
    catch (error) {
      const status = error !== null && typeof error === 'object' && 'status' in error ? Number(error.status) : 0;
      if (quota.daily || retry >= 6 || status > 0 && status !== 408 && status !== 409 && status !== 429 && status < 500) throw error;
      append({ event: 'retry', scenarioId: activeScenario, afterAttempt: attempt, delayMs: nextRetryMs || Math.min(60000, 2000 * 2 ** retry) });
    }
  }
} };
let stopped = offline ? 'offline-recovery-only' : 'completed';
if (!offline) {
  const engine = new LlmEngine({ ...baseOptions, client });
  for (const scenario of ALL_BENCHMARK_SCENARIOS) {
    if (completed.has(scenario.id)) continue;
    activeScenario = scenario.id; currentRequestIds = [];
    const summary = await runner.runSuite(engine, [scenario], { runId: `${sessionId}-${scenario.id}`, modelName: model, concurrency: 1, codeHash });
    await saveEvaluationRun(runner, summary, path.join(sessionDir, 'attempts'));
    const result = summary.scenarioResults[0];
    if (result.decisionSource === 'execution-failure') {
      stopped = quota.daily ? 'daily-quota' : 'execution-failure';
      fs.writeFileSync(path.join(sessionDir, 'stopped.json'), JSON.stringify({ reason: stopped, scenarioId: scenario.id,
        retryPolicy: quota, failureReason: result.failureReason }, null, 2)); break;
    }
    saveCheckpoint(checkpoints, scenario.id, { result, codeHash, fullDataHash: identity.dataHash,
      evidence: { journal: path.relative(root, path.join(sessionDir, 'transport.ndjson')), ids: currentRequestIds },
      latencyMethod: '本次有效决策的执行器耗时，含排队/限流/退避，不含跨日停顿或前次失败会话' } satisfies Checkpoint);
    completed = load(); log(`检查点 ${completed.size}/55：${scenario.id} ${result.passed ? '通过' : '未达战术期望'}`);
  }
}
const ordered = ALL_BENCHMARK_SCENARIOS.flatMap(s => completed.has(s.id) ? [completed.get(s.id)!.result] : []);
const progress = { updatedAt: new Date().toISOString(), status: completed.size === 55 ? 'completed' : stopped,
  completed: completed.size, planned: 55, passed: ordered.filter(r => r.passed).length, legal: ordered.filter(r => r.isLegal).length,
  pending: ALL_BENCHMARK_SCENARIOS.filter(s => !completed.has(s.id)).map(s => s.id), codeHash, dataHash: identity.dataHash,
  phases: Object.fromEntries(['bidding','trump','bury','playing'].map(p => [p, {
    completed: ordered.filter(r => r.phase === p).length, passed: ordered.filter(r => r.phase === p && r.passed).length }])),
  retryPolicy: quota, note: '未完成题不计作策略失败，也不以已完成题通过率冒充全55题成绩。原始失败和重试留在各会话日志。' };
fs.writeFileSync(path.join(root, 'progress.json'), JSON.stringify(progress, null, 2));
if (completed.size === 55) {
  const avg = (values: number[]) => values.length ? Math.round(values.reduce((a,b) => a+b,0) / values.length) : 0;
  const pct = (values: number[], p: number) => [...values].sort((a,b) => a-b)[Math.min(Math.floor(p*values.length), values.length-1)] ?? 0;
  const phaseSummaries = Object.fromEntries((['bidding','trump','bury','playing'] as EvalPhase[]).map(p => {
    const group = ordered.filter(r => r.phase === p);
    return [p, { total: group.length, passed: group.filter(r => r.passed).length, averageScore: avg(group.map(r => r.score)),
      p50LatencyMs: pct(group.map(r => r.latencyMs), .5), p95LatencyMs: pct(group.map(r => r.latencyMs), .95) }];
  })) as BenchmarkReportSummary['phaseSummaries'];
  const finalResults = ordered.map((result, i) => ({ ...result, logicalDecisionId: `gemini-3_8-flash-low-resumed:${i}`,
    engineConfigSnapshot: { ...identity.engineConfigSnapshot, codeHash, dataHash: identity.dataHash, configHash: identity.configHash } }));
  const summary: BenchmarkReportSummary = { ...identity, suiteVersion: baseline.suiteVersion,
    coverage: scenarioCoverage(ALL_BENCHMARK_SCENARIOS, ALL_BENCHMARK_SCENARIOS.map(s => s.setup())),
    runId: 'gemini-3_8-flash-low-resumed', engineType: 'llm', modelName: model, timestamp: new Date().toISOString(),
    scenarioIds: ordered.map(r => r.scenarioId), totalScenarios: 55, passedCount: progress.passed, passRate: progress.passed/55,
    legalCount: progress.legal, legalRate: progress.legal/55, plannedModelCalls: 55,
    actualModelCalls: ordered.reduce((n,r) => n + (r.modelRequestCount ?? 0),0),
    actualModelRetries: ordered.reduce((n,r) => n + (r.modelRetryCount ?? 0),0),
    nativeCallCount: ordered.filter(r => (r.modelRequestCount ?? 0)>0).length,
    nativeSuccessCount: ordered.filter(r => r.isNative && r.isLegal).length,
    nativeSuccessRate: ordered.filter(r => r.isNative && r.isLegal).length/55,
    executionFailureCount: 0, fallbackCount: 0, fallbackRate: 0, mockCount: 0, mockRate: 0,
    averageScore: avg(ordered.map(r => r.score)), phaseMacroAverageScore: avg(Object.values(phaseSummaries).map(p => p.averageScore)),
    averageLatencyMs: avg(ordered.map(r => r.latencyMs)), p50LatencyMs: pct(ordered.map(r => r.latencyMs),.5),
    p95LatencyMs: pct(ordered.map(r => r.latencyMs),.95), phaseSummaries, scenarioResults: finalResults };
  await saveEvaluationRun(runner, summary, path.join(root,'results'));
  // 全量历史运营请求/失败另汇总，不把之前失败会话从服务成本与可靠性里抹掉。
  log('55题完成；生成最终报告时同时审计全部初轮和续跑日志，不能只统计最后有效会话。');
}
log(JSON.stringify(progress));
log(execFileSync('python3', [path.join(root, 'summarize.py')], { encoding: 'utf8' }).trim());
