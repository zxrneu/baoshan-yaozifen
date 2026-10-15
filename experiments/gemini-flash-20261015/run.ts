/** Gemini 单轮评测编排；复用产品输入与裁判，独立保存传输和成本证据，遵循单一职责原则。 */
import fs from 'node:fs';
import path from 'node:path';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { OpenAiSdkClient } from '@yaozifen/ai-core/engines/llm/llmClient';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { evaluationSourceHash, saveEvaluationRun } from '../../scripts/eval-artifacts';

const root = path.resolve('experiments/gemini-flash-20261015');
const runId = 'gemini-3_8-flash-low-r1';
const out = path.join(root, 'results');
const dir = path.join(out, runId);
// 用户已授权跑完整轮、不按金额截断；仍保留公开价估算。
const budget: number | null = null;
const maxRetries = 6;
const requestTimeoutMs = 180000;
const decisionTimeoutMs = 600000;
if (fs.existsSync(path.join(dir, 'summary.json'))) throw new Error('已有结果，拒绝覆盖');
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').flatMap(line => {
  const s = line.trim(); const i = s.indexOf('=');
  return !s || s.startsWith('#') || i < 0 ? [] : [[s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]];
}));
const key = env.GEMINI_KEY;
if (!key) throw new Error('缺少 GEMINI_KEY');
fs.mkdirSync(dir, { recursive: true });
const append = (value: unknown) => fs.appendFileSync(path.join(dir, 'transport.ndjson'), JSON.stringify(value) + '\n');
const log = console.log.bind(console);
console.log = () => {}; console.error = () => {}; console.warn = () => {};
const model = 'gemini-3.8-flash';
const endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
const price = { inputPerTokenUsd: 0.75 / 1e6, outputPerTokenUsd: 3.75 / 1e6 };
let spent = 0; let reserved = 0; let sequence = 0; let phase = 'probe';
const inFlight = new Set<Promise<Response>>();
function errorInfo(error: unknown): unknown {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & { code?: unknown; cause?: unknown };
  return { name: e.name, message: e.message.split(key).join('<redacted>'), code: e.code, cause: e.cause ? errorInfo(e.cause) : null };
}
const fetchFn: typeof fetch = (url, init) => {
  const task = (async () => {
    const id = ++sequence; const started = Date.now();
    append({ event: 'entry', id, phase, at: new Date().toISOString() });
    let reserve = 0; let admitted = false;
    try {
      const bodyText = typeof init?.body === 'string' ? init.body : await new Request(url, init).text();
      const body = JSON.parse(bodyText) as { messages: unknown; max_tokens: number };
      reserve = (Buffer.byteLength(JSON.stringify(body.messages)) + 1024) * price.inputPerTokenUsd + body.max_tokens * price.outputPerTokenUsd;
      if (budget !== null && spent + reserved + reserve > budget) {
        append({ event: 'budget-blocked', id, spent, reserved, reserve, budget });
        throw new Error('预算预留不足，未发起 HTTP 请求');
      }
      reserved += reserve; admitted = true;
      append({ event: 'request', id, phase, request: body, reserveUsd: reserve });
      const response = await fetch(url, init);
      const raw = await response.clone().text();
      let parsed: Record<string, unknown> | undefined;
      try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { /* 原始响应仍保存。 */ }
      const usage = parsed?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      const actual = usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)
        ? usage.prompt_tokens! * price.inputPerTokenUsd + usage.completion_tokens! * price.outputPerTokenUsd : null;
      spent += actual ?? reserve;
      append({ event: 'response', id, phase, ms: Date.now() - started, status: response.status,
        response: parsed ?? raw.split(key).join('<redacted>'), usage: usage ?? null, estimatedCostUsd: actual,
        accountedCostUsd: actual ?? reserve, spentUsd: spent,
        retryAfter: response.headers.get('retry-after'), retryAfterMs: response.headers.get('retry-after-ms') });
      log(`${phase} 请求 ${id}: HTTP ${response.status}；累计计价/保守预留 $${spent.toFixed(6)}`);
      return response;
    } catch (error) {
      if (admitted) spent += reserve;
      append({ event: 'error', id, phase, ms: Date.now() - started, error: errorInfo(error), accountedCostUsd: admitted ? reserve : 0 });
      throw error;
    } finally { if (admitted) reserved -= reserve; }
  })();
  inFlight.add(task);
  void task.then(() => inFlight.delete(task), () => inFlight.delete(task));
  return task;
};
const client = new OpenAiSdkClient({ baseUrl: endpoint, apiKey: key, timeoutMs: requestTimeoutMs, maxRetries, fetchFn });
const codeHash = await evaluationSourceHash();
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ model, endpoint, effort: 'low', maxTokens: 8192,
  timeoutMs: decisionTimeoutMs, requestTimeoutMs, concurrency: 2, maxRetries, fallback: false, mock: false, disableBidAdvice: false,
  budgetUsd: budget, price, codeHash, plannedScenarios: 55, probeMaxTokens: 512 }, null, 2));
try {
  const probe = await client.complete({ model, protocol: 'chat', reasoningEffort: 'low', responseFormat: 'json_object',
    maxTokens: 512, messages: [{ role: 'user', content: '仅返回 JSON 对象 {"ok":true}。' }] });
  fs.writeFileSync(path.join(root, 'probe.json'), JSON.stringify(probe, null, 2));
  if (JSON.parse(probe.rawText).ok !== true) throw new Error('探测输出不符合预期');
  phase = 'suite';
  const runner = new BenchmarkRunner();
  const engine = new LlmEngine({ baseUrl: endpoint, model, client, protocol: 'chat', responseFormat: 'json_object',
    reasoningEffort: 'low', maxTokens: 8192, timeoutMs: decisionTimeoutMs, maxRetries, maxConcurrency: 2,
    enableDevMockOnFailure: false, enableFallbackOnFailure: false, disableBidAdvice: false });
  const summary = await runner.runSuite(engine, ALL_BENCHMARK_SCENARIOS, { runId, modelName: model, concurrency: 2, codeHash,
    engineConfig: { provider: 'google-gemini', endpoint, experiment: 'gemini-flash-20261015', repeat: 'r1' } });
  await saveEvaluationRun(runner, summary, out);
  log(JSON.stringify({ passed: summary.passedCount, total: summary.totalScenarios, legal: summary.legalCount,
    native: summary.nativeSuccessCount, failures: summary.executionFailureCount, p50: summary.p50LatencyMs, p95: summary.p95LatencyMs }));
} catch (error) {
  fs.writeFileSync(path.join(root, 'interruption.json'), JSON.stringify({ phase, error: errorInfo(error) }, null, 2));
  log('实验中断', JSON.stringify(errorInfo(error))); process.exitCode = 1;
} finally {
  await Promise.allSettled([...inFlight]);
  fs.writeFileSync(path.join(root, 'accounting.json'), JSON.stringify({ budgetUsd: budget, accountedUsd: spent, reservedUsd: reserved,
    fetchEntries: sequence, price, note: '有完整 usage 按公开价估算；无 usage 的已发起请求按输入字节上界与完整输出额度计入保守预留。非账单。' }, null, 2));
}
