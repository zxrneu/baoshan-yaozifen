/**
 * 全阶段基准执行器与报告生成服务 (SOLID 设计，符合 docs/ai/evaluation-plan.md 规范)。
 * 支持任意符合 DecisionEngine 契约的引擎（Bridge, Algorithm, Laya, LLM 等），
 * 并提供详细的归因统计 (decisionSource)、NDJSON 记录与 Markdown 战报生成。
 */
import { DecisionEngine, ModelRequestEvent } from '@yaozifen/ai-core/engines/engineTypes';
import { LlmDecisionEvaluator, BaseEvaluationReport } from '@yaozifen/ai-core/engines/llm/llmEvaluator';
import { observeBidding, observeTrump, observeBury } from '@yaozifen/game-view/decisionObservation';
import { contentHash, evaluationConfig, scenarioObservation, SUITE_VERSION } from './fingerprint';
import { cardId } from '@yaozifen/game-core/cards';
import { scenarioCoverage, formatScenarioCoverage } from './coverage';
import {
  ALL_BENCHMARK_SCENARIOS,
} from './scenarios';
import {
  EvalScenario,
  ScenarioRunResult,
  BenchmarkReportSummary,
  PhaseSummary,
  DecisionSource,
  EvalPhase,
  EvalErrorCode,
} from './types';

export class BenchmarkRunner {
  private evaluator: LlmDecisionEvaluator;

  constructor(evaluator: LlmDecisionEvaluator = new LlmDecisionEvaluator()) {
    this.evaluator = evaluator;
  }

  async describeRun(engine: DecisionEngine, scenarios: readonly EvalScenario[], options: {
    modelName?: string; concurrency?: number; codeHash?: string; engineConfig?: Record<string, unknown>;
  } = {}, frozenInputs?: readonly { observation: Record<string, unknown>; candidates?: string[] }[]) {
    const inputs = frozenInputs ?? scenarios.map(s => {
      const setup = s.setup();
      return { observation: scenarioObservation(s, setup), candidates: setup.candidates?.map(cardId) };
    });
    const snapshot = evaluationConfig(engine, { modelName: options.modelName, concurrency: options.concurrency ?? 1,
      ...options.engineConfig, attributionProtocolVersion: 2 });
    const dataHash = await contentHash(scenarios.map((s, i) => ({ id: s.id, phase: s.phase,
      description: s.description, optimalActionDesc: s.optimalActionDesc, input: inputs[i],
      definition: s.definition, setup: s.setup.toString(),
      criteria: s.expectedCriteria.toString() })));
    const configHash = await contentHash({ snapshot, codeHash: options.codeHash,
      evaluator: this.evaluator.constructor.toString() });
    return { dataHash, configHash, codeHash: options.codeHash, engineConfigSnapshot: snapshot };
  }

  /**
   * 运行成套基准场景测试
   */
  async runSuite(
    engine: DecisionEngine,
    scenarios: readonly EvalScenario[] = ALL_BENCHMARK_SCENARIOS,
    options: {
      runId?: string;
      modelName?: string;
      concurrency?: number;
      codeHash?: string;
      engineConfig?: Record<string, unknown>;
      dataset?: 'dev' | 'holdout' | string;
    } = {},
  ): Promise<BenchmarkReportSummary> {
    const runId = options.runId ?? `eval-${Date.now()}`;
    const engineType = engine.type;
    const modelName = options.modelName ?? (engine as any).getOptions?.()?.model ?? (engine as any).model ?? undefined;
    const requestedConcurrency = options.concurrency ?? 1;
    if (!Number.isInteger(requestedConcurrency) || requestedConcurrency < 1) throw new Error('concurrency 必须为正整数');
    const concurrency = Math.min(requestedConcurrency, scenarios.length);
    const setups = scenarios.map(s => s.setup());
    const inputs = scenarios.map((s, i) => ({ observation: structuredClone(scenarioObservation(s, setups[i])),
      candidates: setups[i].candidates?.map(cardId) }));
    const coverage = scenarioCoverage(scenarios, setups);
    const identity = await this.describeRun(engine, scenarios, options, inputs);

    const isModelScenarioForEngine = (phase: EvalPhase): boolean => {
      if (engineType === 'llm') return true;
      if (engineType === 'laya') return phase !== 'bury';
      return false;
    };

    const plannedModelCalls = scenarios.filter((s) => isModelScenarioForEngine(s.phase)).length;

    const executeScenario = async (scenario: EvalScenario, index: number): Promise<ScenarioRunResult> => {
      const { state, observation, candidates, seat } = setups[index];
      const t0 = performance.now();
      let report: BaseEvaluationReport;
      let rawDecision: any = null;
      const isModelAttempt = isModelScenarioForEngine(scenario.phase);
      let decisionSource: DecisionSource = isModelAttempt ? 'model' : 'search/heuristic';
      let isNative = false;
      const modelRequests: ModelRequestEvent[] = [];
      const executionOptions = { onModelRequest: (event: ModelRequestEvent) => { modelRequests.push({ ...event }); } };
      const tracksRequests = !isModelAttempt || engine.supportsModelRequestTelemetry === true;
      let failureReason: string | undefined;
      let fallbackReason: string | undefined = undefined;
      let actionTaken = '未知动作';
      let thinking: string | undefined = undefined;
      let conclusion: string | undefined = undefined;
      let sampledWorlds: number | undefined = undefined;

      try {
        if (scenario.phase === 'bidding' && state) {
          const obs = observeBidding(state, seat);
          rawDecision = engine.chooseBid ? await engine.chooseBid(obs, undefined, executionOptions) : await engine.chooseAction?.(obs, undefined, executionOptions);
          report = this.evaluator.evaluateBid(state, seat, rawDecision);
          actionTaken = rawDecision?.action?.bid === null ? 'Pass' : `叫 ${rawDecision?.action?.bid} 分`;
        } else if (scenario.phase === 'trump' && state) {
          const obs = observeTrump(state, seat);
          rawDecision = engine.chooseTrump ? await engine.chooseTrump(obs, undefined, executionOptions) : await engine.chooseAction?.(obs, undefined, executionOptions);
          report = this.evaluator.evaluateTrump(state, seat, rawDecision);
          actionTaken = `定主 ${rawDecision?.action?.trump ?? '未知'}`;
        } else if (scenario.phase === 'bury' && state) {
          const obs = observeBury(state, seat);
          rawDecision = engine.chooseBury ? await engine.chooseBury(obs, undefined, executionOptions) : await engine.chooseAction?.(obs, undefined, executionOptions);
          report = this.evaluator.evaluateBury(state, seat, rawDecision);
          const buriedCards = rawDecision?.action?.cards?.map(cardId) ?? [];
          actionTaken = `扣底 [${buriedCards.join(', ')}]`;
        } else if (scenario.phase === 'playing' && observation && candidates) {
          rawDecision = await engine.chooseCard(observation, candidates, undefined, executionOptions);
          report = this.evaluator.evaluatePlay(observation, candidates, rawDecision);
          actionTaken = `出牌 ${cardId(rawDecision.card)}`;
        } else {
          throw new Error('未知的场景或配置不全');
        }

        thinking = rawDecision?.thinking;
        conclusion = rawDecision?.conclusion;
        fallbackReason = rawDecision?.fallbackReason;
        sampledWorlds = rawDecision?.worldsEvaluated;

        // 归因分析 (Decision Source Attribution)
        if (fallbackReason) {
          if (fallbackReason.includes('开发模拟') || rawDecision?.diagnostic?.includes('模拟')) {
            decisionSource = 'mock';
          } else {
            decisionSource = 'fallback';
          }
        } else if (rawDecision?.decisionSource === 'deterministic') {
          decisionSource = 'deterministic';
        } else if (isModelAttempt) {
          decisionSource = 'model';
          isNative = modelRequests.length > 0;
        } else {
          decisionSource = 'search/heuristic';
        }
      } catch (err) {
        failureReason = err instanceof Error ? err.message : String(err);
        report = {
          isLegal: false,
          score: 0,
          tacticalRating: 'illegal',
          details: `执行抛出异常: ${failureReason}`,
        };
        decisionSource = 'execution-failure';
      }

      const latencyMs = Math.round(performance.now() - t0);

      // 判定是否通过期望标准
      const passed = report.isLegal && scenario.expectedCriteria(report, rawDecision);
      if (!passed && report.isLegal) {
        // 统一评分与判定：未通过预期标准的合法决策，扣减分数至不超过 60 分，降级评级并附详细失误原因
        report.score = Math.min(report.score, 60);
        if (report.tacticalRating === 'optimal' || report.tacticalRating === 'good') {
          report.tacticalRating = 'suboptimal';
        }
        const missReason = `未达成场景最优标准（期望：${scenario.optimalActionDesc}）`;
        report.details = report.details ? `${report.details}；${missReason}` : missReason;
      }

      // 失败原因只用于故障分类；未返回动作时不称作已执行回退。
      let errorCode: EvalErrorCode | undefined;
      const reason = failureReason ?? fallbackReason;
      if (reason) {
        if (/超时|timeout/i.test(reason)) errorCode = 'TIMEOUT';
        else if (/取消|abort|cancel/i.test(reason)) errorCode = 'CANCELLED';
        else if (/fetch failed|ECONN|网络|connection error/i.test(reason)) errorCode = 'NETWORK_ERROR';
        else if (/请求失败 \(\d{3}|HTTP/i.test(reason)) errorCode = 'HTTP_ERROR';
        else if (/非法|不在.*范围/i.test(reason)) errorCode = 'ILLEGAL_ACTION';
        else if (/JSON|解析|parse|未完整结束/i.test(reason)) errorCode = 'PARSE_ERROR';
        else if (/格式|缺失|schema/i.test(reason)) errorCode = 'SCHEMA_ERROR';
        else if (failureReason) errorCode = 'EXECUTION_ERROR';
      } else if (!report.isLegal) {
        errorCode = 'ILLEGAL_ACTION';
      } else if (!passed) {
        errorCode = 'STRATEGY_MISS';
      }
      const modelRequestCount = tracksRequests || decisionSource === 'deterministic' ? modelRequests.length : null;
      const modelRetryCount = modelRequestCount === null ? null : modelRequests.filter(event => event.attempt > 1).length;

      const inputObservation = inputs[index].observation;

      return {
        logicalDecisionId: `${runId}:${index}`,
        modelRequestCount,
        modelRetryCount,
        modelRequests,
        failureReason,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        phase: scenario.phase,
        category: scenario.category,
        passed,
        isLegal: report.isLegal,
        decisionSource,
        isNative,
        score: report.score,
        tacticalRating: report.tacticalRating,
        latencyMs,
        thinking,
        conclusion,
        actionTaken,
        optimalActionDesc: scenario.optimalActionDesc,
        fallbackReason,
        errorCode,
        details: report.details,
        engineConfigSnapshot: { ...identity.engineConfigSnapshot, dataHash: identity.dataHash,
          configHash: identity.configHash, codeHash: identity.codeHash },
        inputObservation,
        candidates: candidates ? candidates.map(cardId) : undefined,
        sampledWorlds,
        rawResponse: rawDecision ? {
          action: rawDecision.action ?? { card: rawDecision.card },
          rawText: rawDecision.rawOutput,
          requestPayload: rawDecision.requestPayload,
          diagnostic: rawDecision.diagnostic,
          worldsEvaluated: rawDecision.worldsEvaluated,
          searchWinRate: rawDecision.searchWinRate,
          searchStatusCounts: rawDecision.searchStatusCounts,
          candidateEvaluations: rawDecision.candidateEvaluations,
          fallbackReason: rawDecision.fallbackReason,
        } : undefined,
      };
    };

    // 并发池调度执行 (保持结果在原 scenarios 顺序)
    const scenarioResults: ScenarioRunResult[] = new Array(scenarios.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < scenarios.length) {
        const idx = nextIndex++;
        scenarioResults[idx] = await executeScenario(scenarios[idx], idx);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const latencies: number[] = [];
    let legalCount = 0;
    let passedCount = 0;
    let totalScore = 0;
    const actualModelCalls = scenarioResults.some(r => r.modelRequestCount === null) ? null
      : scenarioResults.reduce((sum, r) => sum + (r.modelRequestCount ?? 0), 0);
    const actualModelRetries = scenarioResults.some(r => r.modelRetryCount === null) ? null
      : scenarioResults.reduce((sum, r) => sum + (r.modelRetryCount ?? 0), 0);
    let nativeCallCount = 0;
    let executionFailureCount = 0;
    let nativeSuccessCount = 0;
    let fallbackCount = 0;
    let mockCount = 0;

    const phaseGroups: Record<EvalPhase, { scores: number[]; latencies: number[]; passed: number; total: number }> = {
      bidding: { scores: [], latencies: [], passed: 0, total: 0 },
      trump: { scores: [], latencies: [], passed: 0, total: 0 },
      bury: { scores: [], latencies: [], passed: 0, total: 0 },
      playing: { scores: [], latencies: [], passed: 0, total: 0 },
    };

    for (const res of scenarioResults) {
      latencies.push(res.latencyMs);
      totalScore += res.score;
      if (res.isLegal) legalCount++;
      if (res.passed) passedCount++;

      const pGroup = phaseGroups[res.phase];
      pGroup.total++;
      pGroup.scores.push(res.score);
      pGroup.latencies.push(res.latencyMs);
      if (res.passed) pGroup.passed++;

      if ((res.modelRequestCount ?? 0) > 0) nativeCallCount++;
      if (res.isNative && res.isLegal) nativeSuccessCount++;
      if (res.decisionSource === 'fallback') fallbackCount++;
      if (res.decisionSource === 'mock') mockCount++;
      if (res.decisionSource === 'execution-failure') executionFailureCount++;
    }

    const calcAvg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
      return sorted[index];
    };

    const phaseSummaries: Record<EvalPhase, PhaseSummary> = {
      bidding: {
        total: phaseGroups.bidding.total,
        passed: phaseGroups.bidding.passed,
        averageScore: calcAvg(phaseGroups.bidding.scores),
        p50LatencyMs: percentile(phaseGroups.bidding.latencies, 50),
        p95LatencyMs: percentile(phaseGroups.bidding.latencies, 95),
      },
      trump: {
        total: phaseGroups.trump.total,
        passed: phaseGroups.trump.passed,
        averageScore: calcAvg(phaseGroups.trump.scores),
        p50LatencyMs: percentile(phaseGroups.trump.latencies, 50),
        p95LatencyMs: percentile(phaseGroups.trump.latencies, 95),
      },
      bury: {
        total: phaseGroups.bury.total,
        passed: phaseGroups.bury.passed,
        averageScore: calcAvg(phaseGroups.bury.scores),
        p50LatencyMs: percentile(phaseGroups.bury.latencies, 50),
        p95LatencyMs: percentile(phaseGroups.bury.latencies, 95),
      },
      playing: {
        total: phaseGroups.playing.total,
        passed: phaseGroups.playing.passed,
        averageScore: calcAvg(phaseGroups.playing.scores),
        p50LatencyMs: percentile(phaseGroups.playing.latencies, 50),
        p95LatencyMs: percentile(phaseGroups.playing.latencies, 95),
      },
    };

    // 四阶段宏平均分 (仅统计包含有效测试场景的阶段，避免单测某阶段时被未测阶段的0分稀释)
    const activePhases = Object.values(phaseSummaries).filter((p) => p.total > 0);
    const phaseMacroAverageScore = activePhases.length > 0
      ? Math.round(activePhases.reduce((sum, p) => sum + p.averageScore, 0) / activePhases.length)
      : 0;

    const nativeSuccessRate = nativeCallCount > 0
      ? nativeSuccessCount / nativeCallCount
      : null;

    return {
      suiteVersion: SUITE_VERSION,
      coverage,
      ...identity,
      scenarioIds: scenarios.map(s => s.id),
      runId,
      engineType,
      modelName,
      dataset: options.dataset ?? 'dev',
      timestamp: new Date().toISOString(),
      totalScenarios: scenarios.length,
      passedCount,
      passRate: scenarios.length > 0 ? passedCount / scenarios.length : 1.0,
      legalCount,
      legalRate: scenarios.length > 0 ? legalCount / scenarios.length : 1.0,
      plannedModelCalls,
      actualModelCalls,
      actualModelRetries,
      nativeCallCount,
      executionFailureCount,
      nativeSuccessCount,
      nativeSuccessRate,
      fallbackCount,
      fallbackRate: scenarios.length > 0 ? fallbackCount / scenarios.length : 0.0,
      mockCount,
      mockRate: scenarios.length > 0 ? mockCount / scenarios.length : 0.0,
      averageScore: calcAvg(scenarioResults.map((r) => r.score)),
      phaseMacroAverageScore,
      averageLatencyMs: calcAvg(latencies),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      phaseSummaries,
      scenarioResults,
    };
  }

  /**
   * 格式化 Markdown 评测报告
   */
  formatMarkdownReport(summary: BenchmarkReportSummary): string {
    const lines: string[] = [];
    lines.push(`# 保山幺子分 · 全阶段决策能力基准评测报告`);
    lines.push(``);
    lines.push(`- **运行 ID**: \`${summary.runId}\``);
    lines.push(`- **基准套件版本**: \`${summary.suiteVersion}\``);
    lines.push(`- **评测引擎**: \`${summary.engineType}\`${summary.modelName ? ` (模型: \`${summary.modelName}\`)` : ''}`);
    lines.push(`- **评测数据集**: \`${summary.dataset ?? 'dev'}\``);
    lines.push(`- **评测时间**: \`${summary.timestamp}\``);
    lines.push(``);
    lines.push('## 样本覆盖与解释边界');
    lines.push('');
    lines.push(formatScenarioCoverage(summary.coverage));
    lines.push('');
    lines.push(`## 1. 核心指标概览`);
    lines.push(``);
    lines.push(`| 指标 | 结果 | 目标/口径 |`);
    lines.push(`| --- | --- | --- |`);
    lines.push(`| **总场景数** | **${summary.totalScenarios}** | 本次所选场景 |`);
    lines.push(`| **标准通过率** | **${(summary.passRate * 100).toFixed(1)}%** (${summary.passedCount}/${summary.totalScenarios}) | 期望 ≥ 85% |`);
    lines.push(`| **最终合法率** | **${(summary.legalRate * 100).toFixed(1)}%** (${summary.legalCount}/${summary.totalScenarios}) | 红线要求 100% |`);

    const nativeSuccessDisplay = summary.nativeSuccessRate !== null
      ? `${(summary.nativeSuccessRate * 100).toFixed(1)}% (${summary.nativeSuccessCount}/${summary.nativeCallCount})`
      : 'N/A (非模型或未调用)';
    lines.push(`| **计划模型调用** | **${summary.plannedModelCalls}** | 需发起调用总数 |`);
    lines.push(`| **实际调用数** | **${summary.actualModelCalls ?? '未采集'}** | 实际 HTTP 尝试数（含失败和重试） |`);
    lines.push(`| **实际重试数** | **${summary.actualModelRetries ?? '未采集'}** | 同一次请求的额外 HTTP 尝试 |`);
    lines.push(`| **已发起请求的决策数** | **${summary.nativeCallCount}** | 不重复计算重试 |`);
    lines.push(`| **无动作执行失败** | **${summary.executionFailureCount}次** | 单列，不计回退 |`);
    lines.push(`| **原生调用成功率** | **${nativeSuccessDisplay}** | 原生合法动作 / 已发起请求的决策；排除回退和 Mock |`);
    lines.push(`| **回退率** | **${(summary.fallbackRate * 100).toFixed(1)}%** (${summary.fallbackCount}次) | 目标 0% |`);
    if (summary.mockCount > 0) {
      lines.push(`| **离线模拟次数** | **${summary.mockCount}次** (${(summary.mockRate * 100).toFixed(1)}%) | ⚠️ 含本地开发模拟 |`);
    }
    lines.push(`| **阶段宏平均分** | **${summary.phaseMacroAverageScore}** / 100 | 等权四阶段均分 |`);
    lines.push(`| **端到端 P50 耗时** | **${summary.p50LatencyMs} ms** | 交互体验标准 |`);
    lines.push(`| **端到端 P95 耗时** | **${summary.p95LatencyMs} ms** | 长尾控制标准 ≤ 2000 ms |`);
    lines.push(``);
    lines.push(`## 2. 四阶段分项对比`);
    lines.push(``);
    lines.push(`| 阶段 | 场景数 | 通过数 | 通过率 | 平均得分 | P50 延迟 | P95 延迟 |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const [phase, s] of Object.entries(summary.phaseSummaries) as [EvalPhase, PhaseSummary][]) {
      const phaseName = phase === 'bidding' ? '叫分 (Bidding)' : phase === 'trump' ? '定主 (Trump)' : phase === 'bury' ? '扣底 (Bury)' : '出牌 (Playing)';
      const rate = s.total > 0 ? `${((s.passed / s.total) * 100).toFixed(1)}%` : 'N/A';
      lines.push(`| ${phaseName} | ${s.total} | ${s.passed} | ${rate} | ${s.averageScore} | ${s.p50LatencyMs} ms | ${s.p95LatencyMs} ms |`);
    }
    lines.push(``);
    lines.push(`## 3. ${summary.totalScenarios} 组场景详细战报明细`);
    lines.push(``);
    lines.push(`| 场景 ID | 阶段 | 分类 | 状态 | 得分 | 耗时 | 实际动作 | 期望最优动作 | 判定依据 |`);
    lines.push(`| --- | --- | --- | :---: | :---: | --- | --- | --- | --- |`);
    for (const res of summary.scenarioResults) {
      const statusBadge = res.passed ? '✅ 通过' : '❌ 未过';
      lines.push(`| \`${res.scenarioId}\` | ${res.phase} | ${res.category} | ${statusBadge} | ${res.score} | ${res.latencyMs}ms | \`${res.actionTaken}\` | ${res.optimalActionDesc} | ${res.details.replace(/\|/g, '\\|')} |`);
    }
    lines.push(``);
    return lines.join('\n');
  }

  /**
   * 生成标准化评测产物文本内容 (符合 Section 7 规范)
   */
  generateReportFiles(summary: BenchmarkReportSummary): {
    reportMd: string;
    summaryJson: string;
    decisionsNdjson: string;
    manifestJson: string;
  } {
    const reportMd = this.formatMarkdownReport(summary);
    const summaryJson = JSON.stringify(summary, null, 2);
    const decisionsNdjson = summary.scenarioResults.map((r) => JSON.stringify(r)).join('\n');
    const manifestJson = JSON.stringify(
      {
        suiteVersion: summary.suiteVersion,
        dataset: summary.dataset ?? 'dev',
        dataHash: summary.dataHash,
        configHash: summary.configHash,
        codeHash: summary.codeHash,
        scenarioIds: summary.scenarioIds,
        engineConfigSnapshot: summary.engineConfigSnapshot,
        runId: summary.runId,
        engineType: summary.engineType,
        modelName: summary.modelName,
        timestamp: summary.timestamp,
        totalScenarios: summary.totalScenarios,
        coverage: summary.coverage,
        passRate: summary.passRate,
        averageScore: summary.averageScore,
      },
      null,
      2,
    );
    return { reportMd, summaryJson, decisionsNdjson, manifestJson };
  }
}
