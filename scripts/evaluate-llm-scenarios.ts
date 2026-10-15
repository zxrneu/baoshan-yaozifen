/**
 * 真实 LLM 场景基准评测命令行工具 (依据 docs/ai/evaluation-plan.md 规范)。
 * 自动读取 .env 配置，支持指定阶段、模型、输出路径，并输出结构化 NDJSON 与 Markdown 报告。
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluationSourceHash } from './eval-artifacts';
import { LlmEngine } from '@yaozifen/ai-core/engines/llmEngine';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS, BIDDING_SCENARIOS, TRUMP_SCENARIOS, BURY_SCENARIOS, PLAYING_SCENARIOS } from '@yaozifen/ai-eval/scenarios';
import { ALL_HOLDOUT_SCENARIOS, HOLDOUT_BIDDING_SCENARIOS, HOLDOUT_TRUMP_SCENARIOS, HOLDOUT_BURY_SCENARIOS, HOLDOUT_PLAYING_SCENARIOS } from '@yaozifen/ai-eval/holdoutScenarios';
import { EvalPhase, EvalScenario } from '@yaozifen/ai-eval/types';

// 简单轻量加载 .env (避免额外依赖)
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const assigned = args.find(arg => arg.startsWith(`--${name}=`));
  if (assigned !== undefined) return assigned.slice(name.length + 3);
  const index = args.indexOf('--' + name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
function hasFlag(name: string): boolean {
  return args.includes('--' + name);
}

const phaseArg = getArg('phase', '') as EvalPhase | '';
const datasetArg = getArg('dataset', hasFlag('holdout') ? 'holdout' : 'dev');
const dataset: 'dev' | 'holdout' = datasetArg === 'holdout' ? 'holdout' : 'dev';
const model = getArg('model', process.env.LLM_MODEL ?? 'qwen38_27b');
const url = getArg('url', process.env.LLM_BASE_URL ?? 'http://127.0.0.1:8000/v1');
const apiKey = getArg('api-key', process.env.LLM_API_KEY ?? '');
const timeoutMs = Number(getArg('timeout', process.env.LLM_TIMEOUT_MS ?? '60000'));
const format = getArg('format', 'json_object') as any;
const reasoning = getArg('reasoning', process.env.LLM_REASONING_EFFORT ?? 'low') as any;
const maxTokensArg = getArg('max-tokens', process.env.LLM_MAX_TOKENS ?? '');
const maxTokens = maxTokensArg ? Number(maxTokensArg) : undefined;
if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
  console.error(`❌ --max-tokens 必须为正整数，收到: ${maxTokensArg}`);
  process.exit(1);
}
const enableMock = hasFlag('mock');
const disableBidAdvice = hasFlag('disable-bid-advice');
const customOutDir = getArg('output', '');
const concurrency = Number(getArg('concurrency', process.env.LLM_CONCURRENCY ?? '2'));

let scenarios: EvalScenario[];
if (dataset === 'holdout') {
  if (phaseArg === 'bidding') scenarios = HOLDOUT_BIDDING_SCENARIOS;
  else if (phaseArg === 'trump') scenarios = HOLDOUT_TRUMP_SCENARIOS;
  else if (phaseArg === 'bury') scenarios = HOLDOUT_BURY_SCENARIOS;
  else if (phaseArg === 'playing') scenarios = HOLDOUT_PLAYING_SCENARIOS;
  else scenarios = ALL_HOLDOUT_SCENARIOS;
} else {
  if (phaseArg === 'bidding') scenarios = BIDDING_SCENARIOS;
  else if (phaseArg === 'trump') scenarios = TRUMP_SCENARIOS;
  else if (phaseArg === 'bury') scenarios = BURY_SCENARIOS;
  else if (phaseArg === 'playing') scenarios = PLAYING_SCENARIOS;
  else scenarios = ALL_BENCHMARK_SCENARIOS;
}

console.log(`\n=============================================================`);
console.log(`  保山幺子分 · 真实 LLM 全生命周期决策基准评测`);
console.log(`=============================================================`);
console.log(`- 评测模型: ${model}`);
console.log(`- 服务端点: ${url}`);
console.log(`- 数据集: ${dataset} (${dataset === 'holdout' ? '独立保留检验集' : '开发回归集'})`);
console.log(`- 评测阶段: ${phaseArg || '全阶段 (All 4 Phases)'} (共 ${scenarios.length} 个场景)`);
console.log(`- 并发限制: ${concurrency} (Controlled Concurrency)`);
console.log(`- 思考档位: ${reasoning}`);
console.log(`- 回复上限: ${maxTokens ?? '服务端默认'} token`);
console.log(`- 启发建议: ${disableBidAdvice ? '已禁用 (消融对照：测试纯模型独立叫分)' : '启用 (默认附带启发式锚点)'}`);
console.log(`- 响应格式: ${format}`);
console.log(`- 超时上限: ${timeoutMs} ms`);
console.log(`- 离线模拟: ${enableMock ? '开启 (Mock On Failure)' : '关闭 (纯真实调用)'}`);
console.log(`-------------------------------------------------------------\n`);

async function main() {
  const engine = new LlmEngine({
    baseUrl: url,
    apiKey: apiKey || undefined,
    model,
    protocol: 'chat',
    responseFormat: format,
    reasoningEffort: reasoning,
    maxTokens,
    timeoutMs,
    enableDevMockOnFailure: enableMock,
    disableBidAdvice,
    maxConcurrency: concurrency,
  });

  const runner = new BenchmarkRunner();
  const runId = `run-${Date.now()}-${model.replace(/[^a-zA-Z0-9]/g, '_')}`;

  console.log(`🚀 开始执行基准评测 (Run ID: ${runId})...\n`);
  const t0 = performance.now();

  const summary = await runner.runSuite(engine, scenarios, {
    runId,
    modelName: model,
    concurrency,
    codeHash: await evaluationSourceHash(),
    dataset,
  });

  const totalTimeSec = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ 评测执行完毕，总耗时 ${totalTimeSec} 秒。\n`);

  // 输出 Markdown 战报至终端
  const mdReport = runner.formatMarkdownReport(summary);
  console.log(mdReport);

  // 持久化保存报告
  const outDir = customOutDir
    ? path.resolve(customOutDir)
    : path.resolve(process.cwd(), 'experiments/results/engine-model-eval');
  const runDir = path.join(outDir, summary.runId);
  await fs.promises.mkdir(runDir, { recursive: true });

  const files = runner.generateReportFiles(summary);
  const reportPath = path.join(runDir, 'report.md');
  const summaryPath = path.join(runDir, 'summary.json');
  const ndjsonPath = path.join(runDir, 'decisions.ndjson');
  const manifestPath = path.join(runDir, 'manifest.json');

  await fs.promises.writeFile(reportPath, files.reportMd, 'utf-8');
  await fs.promises.writeFile(summaryPath, files.summaryJson, 'utf-8');
  await fs.promises.writeFile(ndjsonPath, files.decisionsNdjson, 'utf-8');
  await fs.promises.writeFile(manifestPath, files.manifestJson, 'utf-8');

  console.log(`\n📁 评测产物已保存至目录: ${runDir}`);
  console.log(`  - 汇总战报: ${reportPath}`);
  console.log(`  - 结构指标: ${summaryPath}`);
  console.log(`  - 决策行记: ${ndjsonPath}`);
  console.log(`=============================================================\n`);

  if (summary.passRate < 0.7 || summary.legalRate < 1.0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`❌ 评测过程中断退出:`, err);
  process.exit(1);
});
