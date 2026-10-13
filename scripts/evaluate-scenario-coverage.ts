/** 评测覆盖审计入口；按单一职责原则只统计公开样本，不调用决策引擎或服务。 */
import { ALL_BENCHMARK_SCENARIOS } from '../src/ai/eval/scenarios';
import { formatScenarioCoverage, scenarioCoverage } from '../src/ai/eval/coverage';
import { SUITE_VERSION } from '../src/ai/eval/fingerprint';

const coverage = scenarioCoverage(ALL_BENCHMARK_SCENARIOS, ALL_BENCHMARK_SCENARIOS.map(s => s.setup()));
console.log(`# 评估样本覆盖审计 · ${SUITE_VERSION} · ${coverage.total} 例\n`);
console.log(formatScenarioCoverage(coverage));
