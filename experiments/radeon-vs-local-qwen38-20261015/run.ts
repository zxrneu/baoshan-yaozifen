/**
 * Radeon DeepSeek-V4.1-Flash 与本地 qwen38_27b 的场景对照编排（2026-10-15 实验）。
 * 复用产品观察与统一裁判；只替换实际传输，用于记录 429/5xx 退避与预算护栏。
 * 遵循单一职责：本文件只做实验编排与传输证据落盘，不改动产品行为。
 */
import fs from 'node:fs';
import path from 'node:path';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { OpenAiSdkClient } from '@yaozifen/ai-core/engines/llm/llmClient';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { evaluationSourceHash, saveEvaluationRun } from '../../scripts/eval-artifacts';

const root = path.resolve('experiments/radeon-vs-local-qwen38-20261015');
const out = path.join(root, 'results');
fs.mkdirSync(out, { recursive: true });

function readEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').flatMap(line => {
    const s = line.trim();
    if (!s || !s.includes('=')) return [];
    const i = s.indexOf('=');
    return [[s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]];
  }));
}
const env = { ...readEnv('.env.example'), ...readEnv('.env'), ...process.env };

const radeonUrl = 'https://developer.amd.com.cn/radeon/api/v1';
const radeonKey = env.RADEON_KEY || env.RADEON_API_KEY || env.RADEON_API_KAY || '';
const localUrl = 'http://211.141.18.165:6195/v1';

const timeoutMs = 180000;
const maxTokens = 8192;
const concurrency = 1;
const budget = Number(process.env.SWEEP_BUDGET ?? 5);

// 产品调试日志量大；逐请求证据与进度分别落盘。
console.log = () => {};
console.error = () => {};
console.warn = () => {};
const log = process.stdout.write.bind(process.stdout);

interface Config {
  provider: string; model: string; url: string; key?: string;
  pricing?: { prompt?: string; completion?: string };
}

function append(file: string, value: unknown) {
  fs.appendFileSync(file, JSON.stringify(value) + '\n');
}

let spent = 0;
const codeHash = await evaluationSourceHash();
const mode = process.argv[2] ?? 'all';

/**
 * 传输观察点：只记录证据并透传给 SDK，不在此层重试。
 * 429/5xx 的重试与退避交给 SDK 自身的 maxRetries —— 在该层重试会让已 abort 的
 * 超时信号立即再次 abort，产生 ms≈0 的伪超时，污染延迟与失败统计。
 */
async function observedFetch(url: string, init: RequestInit, runDir: string) {
  const started = Date.now();
  try {
    const response = await fetch(url, init);
    if (response.status === 429 || response.status >= 500) {
      const body = await response.clone().text();
      append(path.join(runDir, 'transport.ndjson'), {
        event: 'retryable-status', at: new Date().toISOString(), status: response.status,
        ms: Date.now() - started, body: body.slice(0, 400),
      });
    }
    return response;
  } catch (error) {
    append(path.join(runDir, 'transport.ndjson'), {
      event: 'network-error', at: new Date().toISOString(),
      ms: Date.now() - started, error: String(error),
    });
    throw error;
  }
}

async function run(config: Config) {
  const id = `${config.provider}-${config.model.replace(/[^a-zA-Z0-9]/g, '_')}-low-r1`;
  const runDir = path.join(out, id);
  if (fs.existsSync(path.join(runDir, 'summary.json'))) { log(`已存在，保留并跳过 ${id}\n`); return; }
  fs.mkdirSync(runDir, { recursive: true });
  const transportPath = path.join(runDir, 'transport.ndjson');
  let completed = 0;
  const promptPrice = Number(config.pricing?.prompt ?? 0);
  const completionPrice = Number(config.pricing?.completion ?? 0);

  const fetchFn: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    // UTF-8 字节数加消息开销作为保守输入 token 上界。
    const reserve = (Buffer.byteLength(JSON.stringify(body.messages)) + 1024) * promptPrice + maxTokens * completionPrice;
    if (config.provider === 'radeon' && spent + reserve > budget) {
      append(transportPath, { event: 'budget-blocked', spent, reserve, budget });
      throw new Error('实验预声明预算不足，拒绝发起请求');
    }
    const started = Date.now();
    const response = await observedFetch(url, { ...init, body: JSON.stringify(body) }, runDir);
    const raw = await response.clone().text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(raw); } catch { /* 保留无法解析的原始响应 */ }
    const usage = json.usage;
    const actualCost = usage
      ? Number(usage.prompt_tokens ?? 0) * promptPrice + Number(usage.completion_tokens ?? 0) * completionPrice
      : reserve;
    if (config.provider === 'radeon') spent += actualCost;
    const message = json.choices?.[0]?.message;
    append(transportPath, {
      at: new Date().toISOString(), ms: Date.now() - started, status: response.status,
      request: body, response: json.choices || json.error ? json : String(raw).slice(0, 1000),
      usage: usage ?? null, actualCost: config.provider === 'radeon' ? actualCost : null,
      finish: json.choices?.[0]?.finish_reason ?? null,
      reasoningChars: String(message?.reasoning_content ?? message?.reasoning ?? '').length,
      contentChars: String(message?.content ?? '').length,
    });
    completed++;
    if (completed % 5 === 0) log(`${id}: ${completed} 次响应完成；累计计价 ${spent.toFixed(5)}\n`);
    return response;
  };

  const client = new OpenAiSdkClient({
    baseUrl: config.url, apiKey: config.key, timeoutMs, maxRetries: 5, fetchFn,
  });
  const engine = new LlmEngine({
    baseUrl: `http://${config.provider}.invalid/v1`, model: config.model, client,
    protocol: 'chat', responseFormat: 'json_object', reasoningEffort: 'low',
    timeoutMs, maxTokens, maxRetries: 5, maxConcurrency: concurrency,
    enableDevMockOnFailure: false, enableFallbackOnFailure: false, disableBidAdvice: false,
  });

  const runner = new BenchmarkRunner();
  log(`开始 ${id}\n`);
  const start = Date.now();
  const summary = await runner.runSuite(engine, ALL_BENCHMARK_SCENARIOS, {
    runId: id, modelName: config.model, concurrency, codeHash,
    engineConfig: {
      provider: config.provider, reasoningEffort: 'low', endpoint: config.provider,
      experiment: 'radeon-vs-local-qwen38-20261015', repeat: 'r1',
    },
  });
  await saveEvaluationRun(runner, summary, out);
  fs.writeFileSync(path.join(runDir, 'timing.json'), JSON.stringify({ wallMs: Date.now() - start, completed, spent, budget }, null, 2));
  log(JSON.stringify({
    id, passed: summary.passedCount, total: summary.totalScenarios,
    native: summary.nativeSuccessCount, failures: summary.executionFailureCount,
    p50: summary.p50LatencyMs, p95: summary.p95LatencyMs,
    wallSec: Math.round((Date.now() - start) / 1000),
  }) + '\n');
}

const configs: Record<string, Config> = {
  radeon: {
    provider: 'radeon', model: 'DeepSeek-V4.1-Flash', url: radeonUrl, key: radeonKey,
    pricing: { prompt: '2.8e-7', completion: '5.6e-7' },
  },
  local38: { provider: 'local38', model: 'qwen38_27b', url: localUrl, key: env.LLM_API_KEY },
};

try {
  if (mode === 'all' || mode === 'local38') await run(configs.local38);
  if (mode === 'all' || mode === 'radeon') {
    if (!radeonKey) throw new Error('缺少 RADEON_KEY');
    await run(configs.radeon);
  }
  log('本批次结束\n');
} catch (error) {
  log(`实验中断 ${String(error)}\n`);
  process.exitCode = 1;
}
