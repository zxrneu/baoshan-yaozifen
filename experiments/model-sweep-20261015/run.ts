/** 模型档位实验编排；复用产品观察与统一裁判，传输证据独立落盘，遵循单一职责原则。 */
import fs from 'node:fs';
import path from 'node:path';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { OpenAiSdkClient, type ReasoningEffort } from '@yaozifen/ai-core/engines/llm/llmClient';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { evaluationSourceHash, saveEvaluationRun } from '../../scripts/eval-artifacts';

const root = path.resolve('experiments/model-sweep-20261015');
const out = path.join(root, 'results');
fs.mkdirSync(out, { recursive: true });
function readEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').flatMap(line => {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) return [];
    const i = s.indexOf('=');
    return [[s.slice(0, i).trim(), s.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]];
  }));
}
const env = { ...readEnv('.env.example'), ...readEnv('.env'), ...process.env };
const localUrl = env.LLM_BASE_URL!;
const timeoutMs = 180000;
const maxTokens = 8192;
const concurrency = 2;
const codeHash = await evaluationSourceHash();
const mode = process.argv[2] ?? 'local';
const log = console.log.bind(console);
// 产品调试日志内容很多；逐请求证据和每十次完成进度单独保存。
console.log = () => {};
console.error = () => {};
console.warn = () => {};
interface ModelInfo { id: string; output?: string[]; pricing?: { prompt: string; completion: string }; [key: string]: unknown }
interface Config { provider: string; model: string; effort: string; url: string; key?: string; pricing?: ModelInfo['pricing'] }
const sourceConfigs: Config[] = [
  { provider: 'local35', model: 'qwen35_27b', effort: '', url: localUrl.replace(':6195', ':6091'), key: env.LLM_API_KEY },
  { provider: 'local38', model: 'qwen38_27b', effort: '', url: localUrl.replace(':6091', ':6195'), key: env.LLM_API_KEY },
];
function append(file: string, value: unknown) { fs.appendFileSync(file, JSON.stringify(value) + '\n'); }
let spent = 0;
let reserved = 0;
const budget = Number(process.env.SWEEP_RADEON_BUDGET ?? 0);
async function run(config: Config, repeat = 'r1') {
  const id = `${config.provider}-${config.model.replace(/[^a-zA-Z0-9]/g, '_')}-${config.effort}-${repeat}`;
  const runDir = path.join(out, id);
  if (fs.existsSync(path.join(runDir, 'summary.json'))) { log('已存在，保留并跳过', id); return; }
  fs.mkdirSync(runDir, { recursive: true });
  let completed = 0;
  const fetchFn: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (config.effort === 'default') delete body.reasoning_effort;
    else body.reasoning_effort = config.effort;
    const promptPrice = Number(config.pricing?.prompt ?? 0);
    const completionPrice = Number(config.pricing?.completion ?? 0);
    // UTF-8 字节数加消息开销作为保守输入 token 上界；不以平均长度超支。
    const reserve = (Buffer.byteLength(JSON.stringify(body.messages)) + 1024) * promptPrice + maxTokens * completionPrice;
    if (config.provider === 'radeon' && spent + reserved + reserve > budget) {
      append(path.join(runDir, 'transport.ndjson'), { event: 'budget-blocked', spent, reserved, reserve, budget });
      throw new Error('实验预声明预算不足，拒绝发起请求');
    }
    reserved += reserve;
    const started = Date.now();
    try {
      const response = await fetch(url, { ...init, body: JSON.stringify(body) });
      const raw = await response.clone().text();
      let json: Record<string, any> = {};
      try { json = JSON.parse(raw); } catch { /* 保留无法解析的原始响应 */ }
      const usage = json.usage;
      const actualCost = usage ? Number(usage.prompt_tokens ?? 0) * promptPrice + Number(usage.completion_tokens ?? 0) * completionPrice : reserve;
      if (config.provider === 'radeon') spent += actualCost;
      const message = json.choices?.[0]?.message;
      append(path.join(runDir, 'transport.ndjson'), {
        at: new Date().toISOString(), ms: Date.now() - started, status: response.status,
        request: body, response: json.choices || json.error ? json : raw,
        usage: usage ?? null, actualCost: config.provider === 'radeon' ? actualCost : null,
        finish: json.choices?.[0]?.finish_reason ?? null,
        reasoningChars: String(message?.reasoning_content ?? message?.reasoning ?? '').length,
        contentChars: String(message?.content ?? '').length,
      });
      completed++;
      if (completed % 10 === 0) log(`${id}: ${completed} 次响应完成；累计 Radeon 计价 ${spent.toFixed(5)}`);
      return response;
    } catch (error) {
      append(path.join(runDir, 'transport.ndjson'), { at: new Date().toISOString(), ms: Date.now() - started, event: 'network-error', error: String(error) });
      // 无 usage 的在途失败按完整预留计价，避免低估总预算。
      if (config.provider === 'radeon') spent += reserve;
      throw error;
    } finally { reserved -= reserve; }
  };
  const effort: ReasoningEffort = config.effort === 'xhigh' ? 'high' : config.effort as ReasoningEffort;
  const client = new OpenAiSdkClient({ baseUrl: config.url, apiKey: config.key, timeoutMs, maxRetries: 0, fetchFn });
  const engine = new LlmEngine({
    baseUrl: `http://${config.provider}.invalid/v1`, model: config.model, client,
    protocol: 'chat', responseFormat: 'json_object', reasoningEffort: effort,
    timeoutMs, maxTokens, maxRetries: 0, maxConcurrency: concurrency,
    enableDevMockOnFailure: false, enableFallbackOnFailure: false, disableBidAdvice: false,
  });
  const runner = new BenchmarkRunner();
  log('开始', id);
  const start = Date.now();
  const summary = await runner.runSuite(engine, ALL_BENCHMARK_SCENARIOS, {
    runId: id, modelName: config.model, concurrency, codeHash,
    engineConfig: { provider: config.provider, reasoningEffort: config.effort, endpoint: config.provider, experiment: 'model-sweep-20261015', repeat },
  });
  await saveEvaluationRun(runner, summary, out);
  fs.writeFileSync(path.join(runDir, 'timing.json'), JSON.stringify({ wallMs: Date.now() - start, completed, spent, budget }, null, 2));
  log(JSON.stringify({ id, passed: summary.passedCount, total: summary.totalScenarios, native: summary.nativeSuccessCount, failures: summary.executionFailureCount, p50: summary.p50LatencyMs, p95: summary.p95LatencyMs, wallSec: Math.round((Date.now() - start) / 1000) }));
}
try {
  if (mode === 'local') {
    await Promise.all(sourceConfigs.map(async config => {
      const efforts = config.provider === 'local35' ? ['none', 'low', 'medium', 'high'] : ['none', 'low', 'medium', 'xhigh'];
      for (const effort of efforts) await run({ ...config, effort });
    }));
  } else if (mode === 'radeon') {
    if (!(budget > 0)) throw new Error('Radeon 调用需要显式提供已授权的 SWEEP_RADEON_BUDGET');
    const url = 'https://developer.amd.com.cn/radeon/api/v1';
    const key = env.RADEON_API_KAY || env.RADEON_API_KEY;
    const r = await fetch(url + '/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Radeon models HTTP ${r.status}`);
    const data = await r.json() as { data: ModelInfo[] };
    fs.writeFileSync(path.join(root, 'radeon-models.json'), JSON.stringify(data, null, 2));
    // 先跑截图中的九个模型，再跑清单额外两个文本小模型；单模型串行切换。
    const models = data.data.filter(m => m.output?.includes('text'));
    models.sort((a, b) => Number(/MiniCPM5|MiniCPM-V-4.7-1B/.test(a.id)) - Number(/MiniCPM5|MiniCPM-V-4.7-1B/.test(b.id)));
    for (const model of models) await run({ provider: 'radeon', model: model.id, effort: 'low', url, key, pricing: model.pricing });
  } else if (mode === 'repeat') {
    const provider = process.argv[3]; const effort = process.argv[4];
    const config = sourceConfigs.find(c => c.provider === provider);
    if (!config) throw new Error('未知本地服务');
    await run({ ...config, effort }, 'r2');
  } else throw new Error('未知模式');
  log('本批次结束');
} catch (error) { log('实验中断', String(error)); process.exitCode = 1; }
