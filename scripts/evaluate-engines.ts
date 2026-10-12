/**
 * 多引擎全生命周期横向基准对比评测脚本 (scripts/evaluate-engines.ts)。
 * 依据 docs/ai-engine-model-evaluation-plan.md 规范，对 Bridge(Fast/Deep)、Algorithm、Laya、LLM
 * 进行所选场景基准评测，输出跨引擎横向对比矩阵与多维度分析报告。
 */
import fs from 'node:fs';
import path from 'node:path';
import { evaluationSourceHash, saveEvaluationRun, archiveCurrentReports } from './eval-artifacts';
import { compatibleSummary } from '../src/ai/eval/fingerprint';
import { BridgeEngine } from '../src/ai/bridge/bridgeEngine';
import { AlgorithmEngine } from '../src/ai/engines/algorithmEngine';
import { LayaEngine } from '../src/ai/engines/layaEngine';
import { LlmEngine } from '../src/ai/engines/llmEngine';
import { createOptimizedSelector } from '../src/ai/optimized';
import { BenchmarkRunner } from '../src/ai/eval/benchmarkRunner';
import { ALL_BENCHMARK_SCENARIOS } from '../src/ai/eval/scenarios';
import { BenchmarkReportSummary, DecisionEngine } from '../src/ai/eval';

import { AsyncCardSelector } from '../src/ai/optimized/contracts';

// 简单轻量加载 .env
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

interface EngineConfig {
  id: string;
  name: string;
  engine: DecisionEngine;
  description: string;
  evaluationConfig?: Record<string, unknown>;
}

async function main() {
  console.log(`\n=============================================================`);
  console.log(`  保山幺子分 · 多引擎横向决策能力基准评测 (Cross-Engine Evaluation)`);
  console.log(`=============================================================`);

  const runner = new BenchmarkRunner();
  const runnerTimestamp = new Date().toISOString();

  // 1. 初始化待测引擎矩阵
  const engineConfigs: EngineConfig[] = [
    {
      id: 'bridge-fast',
      name: 'Bridge (Fast)',
      engine: new BridgeEngine({
        config: {
          mode: 'fast',
          maxWorlds: 0,
          minWorlds: 0,
          timeLimitMs: 0,
          endgameCardLimit: 0,
        },
      }),
      description: '桥牌专家战术规则系统（极速启发式，< 1ms）',
    },
    {
      id: 'bridge-deep',
      name: 'Bridge (Deep PIMC)',
      engine: new BridgeEngine({
        config: {
          mode: 'deep',
          maxWorlds: 32,
          minWorlds: 16,
          timeLimitMs: 250,
          endgameCardLimit: 6,
        },
      }),
      description: '位棋盘 DDS + PIMC，截断后快速续打估计',
    },
    {
      id: 'algorithm-optimized',
      evaluationConfig: { budget: { timeLimitMs: 250, minWorlds: 8, maxWorlds: 64 } },
      name: 'Algorithm (Optimized)',
      engine: new AlgorithmEngine({
        choose: async (obs) => {
          const syncSelector = createOptimizedSelector({
            budget: {
              timeLimitMs: 250,
              minWorlds: 8,
              maxWorlds: 64,
            },
          });
          return syncSelector.choose(obs);
        },
      } as AsyncCardSelector),
      description: '配对胜率搜索 + 约束采样 + 残局求解器',
    },
    {
      id: 'laya',
      name: 'Laya (Ollaya/Fallback)',
      engine: new LayaEngine({
        baseUrl: process.env.LAYA_BASE_URL ?? 'http://127.0.0.1:11435',
        model: process.env.LAYA_MODEL ?? 'laya:multilingual',
        timeoutMs: Number(process.env.LAYA_TIMEOUT_MS ?? '5000'),
        enableFallbackOnFailure: true,
      }),
      description: '非自回归小模型 (TypeSafe / Ollaya laya:multilingual)',
    },
    {
      id: 'llm',
      name: `LLM (${process.env.LLM_MODEL ?? 'qwen38_27b'})`,
      engine: new LlmEngine({
        baseUrl: process.env.LLM_BASE_URL ?? 'http://127.0.0.1:8000/v1',
        apiKey: process.env.LLM_API_KEY ?? '',
        model: process.env.LLM_MODEL ?? 'qwen38_27b',
        protocol: (process.env.LLM_PROTOCOL as any) ?? 'chat',
        responseFormat: 'json_object',
        reasoningEffort: (process.env.LLM_REASONING as any) ?? 'low',
        disableBidAdvice: process.env.LLM_DISABLE_BID_ADVICE === '1',
        timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? '60000'),
        enableDevMockOnFailure: false, // 正式评测关闭 Mock，真实检验模型可达性
        maxConcurrency: Number(process.env.LLM_CONCURRENCY ?? '2'),
      }),
      description: '大语言模型全生命周期决策引擎（含长思维链与结构化解析）',
    },
  ];

  const args = process.argv.slice(2);
  let targetEngineId: string | undefined;
  let targetPhase: string | undefined;
  let concurrency = Number(process.env.LLM_CONCURRENCY ?? process.env.EVAL_CONCURRENCY ?? '2');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--engine' && args[i + 1]) {
      targetEngineId = args[++i];
    } else if (args[i].startsWith('--engine=')) {
      targetEngineId = args[i].split('=')[1];
    } else if (args[i] === '--phase' && args[i + 1]) {
      targetPhase = args[++i];
    } else if (args[i].startsWith('--phase=')) {
      targetPhase = args[i].split('=')[1];
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = Number(args[++i]);
    } else if (args[i].startsWith('--concurrency=')) {
      concurrency = Number(args[i].split('=')[1]);
    }
  }

  const activeConfigs = targetEngineId === 'offline'
    ? engineConfigs.filter(c => c.id.startsWith('bridge-') || c.id === 'algorithm-optimized')
    : targetEngineId
    ? engineConfigs.filter((c) => c.id === targetEngineId || c.id.includes(targetEngineId))
    : engineConfigs;

  const scenariosToRun = targetPhase
    ? ALL_BENCHMARK_SCENARIOS.filter((s) => s.phase === targetPhase)
    : ALL_BENCHMARK_SCENARIOS;

  if (!activeConfigs.length || !scenariosToRun.length) throw new Error('没有匹配的引擎或阶段');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('并发度必须为正整数');
  const codeHash = await evaluationSourceHash();

  console.log(`  [配置] 引擎: ${targetEngineId ?? '全部'} | 阶段: ${targetPhase ?? '全部'} | 场景数: ${scenariosToRun.length} | 并发度: ${concurrency}`);

  const outDir = path.resolve(process.cwd(), 'experiments/results/engine-model-eval');
  const jsonSummaryPath = path.join(outDir, 'cross-engine-summary.json');
  const existingMap = new Map<string, { config: EngineConfig; summary: BenchmarkReportSummary }>();

  if (fs.existsSync(jsonSummaryPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonSummaryPath, 'utf-8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const cfg = engineConfigs.find((c) => c.id === item.id);
          if (cfg && item.summary) {
            const identity = await runner.describeRun(cfg.engine, scenariosToRun,
              { modelName: cfg.name, concurrency, codeHash, engineConfig: cfg.evaluationConfig });
            if (compatibleSummary(item.summary, identity)) existingMap.set(item.id, { config: cfg, summary: item.summary });
            else console.log(`旧成绩 ${item.id} 与本次数据/配置/源码不一致，已排除`);
          }
        }
      }
    } catch {
      // ignore parse error
    }
  }

  const freshLlm = args.includes('--fresh-llm');
  const resultsMap = new Map<string, { config: EngineConfig; summary: BenchmarkReportSummary }>(existingMap);

  for (const cfg of activeConfigs) {
    if (cfg.id === 'llm' && !freshLlm && existingMap.has('llm') && targetEngineId !== 'llm') {
      console.log(`\n▶ 跳过 [${cfg.name}] 重新运行 (复用现有评测成绩，传入 --fresh-llm 强制重测)`);
      continue;
    }
    console.log(`\n▶ 正在评测引擎: [${cfg.name}] ...`);
    const t0 = performance.now();
    resultsMap.delete(cfg.id);
    try {
      const summary = await runner.runSuite(cfg.engine, scenariosToRun, {
        runId: `cross-${cfg.id}-${Date.now()}`,
        modelName: cfg.name,
        concurrency,
        codeHash,
        engineConfig: cfg.evaluationConfig,
      });
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`  ✓ 评测完成 (${elapsed}s) | 通过率: ${(summary.passRate * 100).toFixed(1)}% | 合法率: ${(summary.legalRate * 100).toFixed(1)}% | 宏均分: ${summary.phaseMacroAverageScore} | P50延迟: ${summary.p50LatencyMs}ms`);
      await saveEvaluationRun(runner, summary, outDir);
      resultsMap.set(cfg.id, { config: cfg, summary });
    } catch (err: any) {
      console.error(`  ✗ 评测失败:`, err.message);
      process.exitCode = 1;
    }
  }

  const results: Array<{ config: EngineConfig; summary: BenchmarkReportSummary }> = engineConfigs
    .map((c) => resultsMap.get(c.id))
    .filter((r): r is { config: EngineConfig; summary: BenchmarkReportSummary } => Boolean(r));

  // 2. 汇总结算对比表 (Markdown & Console)
  const reportLines: string[] = [];
  reportLines.push(`# 保山幺子分 · 多引擎横向决策能力基准评测报告`);
  reportLines.push(``);
  reportLines.push(`- **评测时间**: \`${runnerTimestamp}\``);
  reportLines.push(`- **评测场景**: ${scenariosToRun.length} 组所选场景 (${targetPhase ?? '全阶段'})`);
  reportLines.push(`- **数据哈希**: \`${results[0]?.summary.dataHash ?? '无结果'}\``);
  reportLines.push(`- **源码哈希**: \`${codeHash}\``);
  reportLines.push(`- 历史模型成绩仅在数据、裁判、配置与源码全部一致时复用；未列出的引擎本轮没有可比结果。`);
  reportLines.push(`- **测试环境**: Node.js (${process.platform} ${process.arch})`);
  reportLines.push(``);
  reportLines.push(`## 1. 跨引擎综合性能与牌理横向对比矩阵`);
  reportLines.push(``);
  reportLines.push(`| 决策引擎 | 架构与模式 | 标准通过率 | 最终合法率 | 宏平均分 | 叫分均分 | 定主均分 | 扣底均分 | 出牌均分 | P50 耗时 | P95 耗时 | 推荐场景 |`);
  reportLines.push(`| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- |`);

  for (const item of results) {
    const s = item.summary;
    const passPct = `${(s.passRate * 100).toFixed(1)}%`;
    const legalPct = `${(s.legalRate * 100).toFixed(1)}%`;
    const macroScore = s.phaseMacroAverageScore;
    const bidScore = s.phaseSummaries.bidding.averageScore;
    const trumpScore = s.phaseSummaries.trump.averageScore;
    const buryScore = s.phaseSummaries.bury.averageScore;
    const playScore = s.phaseSummaries.playing.averageScore;
    const p50 = `${s.p50LatencyMs} ms`;
    const p95 = `${s.p95LatencyMs} ms`;

    let recommendation = '通用参考';
    if (item.config.id === 'bridge-fast') recommendation = '⚡ 极速对弈 / 离线保底';
    else if (item.config.id === 'bridge-deep') recommendation = '🔎 搜索实验 / 需胜副率验证';
    else if (item.config.id === 'algorithm-optimized') recommendation = '🔬 蒙特卡洛纯数学推演对照';
    else if (item.config.id === 'laya') recommendation = '🤖 非自回归小模型端侧实验';
    else if (item.config.id === 'llm') recommendation = '🧠 全生命周期战术推演 & 解说';

    reportLines.push(`| **${item.config.name}** | ${item.config.description} | **${passPct}** | ${legalPct} | **${macroScore}** | ${bidScore} | ${trumpScore} | ${buryScore} | ${playScore} | ${p50} | ${p95} | ${recommendation} |`);
  }

  reportLines.push(``);
  reportLines.push(`## 2. 评测结论与选型建议 (依据实测证据动态生成)`);
  reportLines.push(``);

  // 动态排序
  const sorted = [...results].sort((a, b) => b.summary.phaseMacroAverageScore - a.summary.phaseMacroAverageScore);

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const s = item.summary;
    const isOffline = s.plannedModelCalls > 0 && (s.nativeSuccessCount === 0 || s.fallbackRate === 1.0);

    reportLines.push(`### 排名 ${i + 1}：${item.config.name} (宏均分: ${s.phaseMacroAverageScore}，通过率: ${(s.passRate * 100).toFixed(1)}%)`);
    if (isOffline) {
      reportLines.push(`- **状态提示**：⚠️ 服务离线或调用失败（${s.fallbackCount}/${s.totalScenarios} 轮回退/失败）。未采集到真实有效调用，本成绩仅反映回退兜底表现，不能据此评判该模型的真实牌力。`);
    } else {
      reportLines.push(`- **实测表现**：规则合法率 ${(s.legalRate * 100).toFixed(1)}%，四阶段分项：叫分 ${s.phaseSummaries.bidding.averageScore} / 定主 ${s.phaseSummaries.trump.averageScore} / 扣底 ${s.phaseSummaries.bury.averageScore} / 出牌 ${s.phaseSummaries.playing.averageScore}。P50 耗时 ${s.p50LatencyMs}ms，P95 耗时 ${s.p95LatencyMs}ms。`);
      if (item.config.id === 'bridge-deep') {
        const sampledWorldsList = s.scenarioResults.map(r => r.sampledWorlds).filter((w): w is number => typeof w === 'number' && w > 0);
        const avgWorlds = sampledWorldsList.length > 0 ? (sampledWorldsList.reduce((a, b) => a + b, 0) / sampledWorldsList.length).toFixed(1) : '0';
        reportLines.push(`- **深搜采样验证**：出牌阶段实测有效执行 DDS+PIMC 采样搜索，平均采样世界数: ${avgWorlds}。`);
      }
    }
    reportLines.push(``);
  }

  reportLines.push(`### 客观性与局限性声明`);
  reportLines.push(`1. 本轮基准评测基于 ${scenariosToRun.length} 个单步场景，重点检验规则遵守性、战术模式识别与极端陷阱抗性。`);
  reportLines.push(`2. 全盘终局表现、胜率与团队配合效果，需结合同随机种子交换座位的多轮配对实战对战进行最终裁定。`);
  reportLines.push(``);

  const reportMd = reportLines.join('\n');
  console.log(`\n` + reportMd);

  // 保存跨引擎评测报告至目录
  await fs.promises.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'cross-engine-comparison.md');
  await archiveCurrentReports(outDir, ['cross-engine-comparison.md', 'cross-engine-summary.json']);
  await fs.promises.writeFile(outPath, reportMd, 'utf-8');

  await fs.promises.writeFile(jsonSummaryPath, JSON.stringify(results.map((r) => ({
    id: r.config.id,
    name: r.config.name,
    summary: r.summary,
  })), null, 2), 'utf-8');

  console.log(`\n📁 跨引擎横向评测战报已保存至:`);
  console.log(`  - 汇总报告: ${outPath}`);
  console.log(`  - 结构指标: ${jsonSummaryPath}`);
  console.log(`=============================================================\n`);
}

main().catch((err) => {
  console.error(`❌ 评测过程中断退出:`, err);
  process.exit(1);
});
