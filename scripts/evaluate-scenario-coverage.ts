/** 评测覆盖审计入口；按单一职责原则只统计公开样本，不调用决策引擎或服务。 */
import { ALL_BENCHMARK_SCENARIOS } from '../src/ai/eval/scenarios';
import { ALL_HOLDOUT_SCENARIOS } from '../src/ai/eval/holdoutScenarios';
import { formatScenarioCoverage, scenarioCoverage } from '../src/ai/eval/coverage';
import { SUITE_VERSION } from '../src/ai/eval/fingerprint';

const args = process.argv.slice(2);
const isHoldout =
  args.includes('--holdout') ||
  args.includes('--dataset=holdout') ||
  (args.indexOf('--dataset') >= 0 && args[args.indexOf('--dataset') + 1] === 'holdout');
const dataset = isHoldout ? 'holdout' : 'dev';
const scenarios = isHoldout ? ALL_HOLDOUT_SCENARIOS : ALL_BENCHMARK_SCENARIOS;

const coverage = scenarioCoverage(scenarios, scenarios.map((s) => s.setup()));
console.log(`# 评估样本覆盖审计 (${dataset}) · ${SUITE_VERSION} · ${coverage.total} 例\n`);
console.log(formatScenarioCoverage(coverage));

