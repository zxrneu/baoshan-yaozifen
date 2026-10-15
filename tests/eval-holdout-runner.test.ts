/**
 * 保留集评测接入与身份标识回归测试。
 * 遵循 SRP 与开闭原则，验证评测运行器对保留集与开发集的显式区分、
 * 元数据身份记录（Markdown/JSON/Manifest）以及引擎执行保留集场景的完整性。
 */
import { describe, expect, it } from 'vitest';
import { BenchmarkRunner } from '@yaozifen/ai-eval/benchmarkRunner';
import { BridgeEngine } from '@yaozifen/ai-core/bridge/bridgeEngine';
import { ALL_HOLDOUT_SCENARIOS } from '@yaozifen/ai-eval/holdoutScenarios';

describe('保留集接入评测入口与身份标识', () => {
  const runner = new BenchmarkRunner();
  const engine = new BridgeEngine({
    config: { mode: 'fast', maxWorlds: 0, minWorlds: 0, timeLimitMs: 0, endgameCardLimit: 0 },
  });

  it('BenchmarkRunner 默认标记评测数据集为 dev，指定时记录 holdout 身份', async () => {
    const devSummary = await runner.runSuite(engine, ALL_HOLDOUT_SCENARIOS.slice(0, 1));
    expect(devSummary.dataset).toBe('dev');

    const holdoutSummary = await runner.runSuite(engine, ALL_HOLDOUT_SCENARIOS.slice(0, 1), {
      dataset: 'holdout',
    });
    expect(holdoutSummary.dataset).toBe('holdout');

    const mdReport = runner.formatMarkdownReport(holdoutSummary);
    expect(mdReport).toContain('- **评测数据集**: `holdout`');

    const files = runner.generateReportFiles(holdoutSummary);
    const manifest = JSON.parse(files.manifestJson);
    expect(manifest.dataset).toBe('holdout');
  });

  it('保留集 40 道场景可被决策引擎完整执行且合法率 100%', async () => {
    const summary = await runner.runSuite(engine, ALL_HOLDOUT_SCENARIOS, { dataset: 'holdout' });
    expect(summary.totalScenarios).toBe(40);
    expect(summary.legalRate).toBe(1.0);
    expect(summary.dataset).toBe('holdout');
    expect(summary.phaseSummaries.bidding.total).toBe(8);
    expect(summary.phaseSummaries.trump.total).toBe(8);
    expect(summary.phaseSummaries.bury.total).toBe(8);
    expect(summary.phaseSummaries.playing.total).toBe(16);
  });
});
