import { DecisionEngine } from '../engines/engineTypes';
import { observeDecision, sanitizePlayerObservation } from '../decisionObservation';
import { EvalScenario, ScenarioSetupResult, BenchmarkReportSummary } from './types';

export const SUITE_VERSION = '1.3.0';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]),
  );
  return value;
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

/** 只保存实际传给引擎的观察，不记录其他玩家暗牌或发牌随机种子。 */
export function scenarioObservation(scenario: EvalScenario, setup: ScenarioSetupResult = scenario.setup()): Record<string, unknown> {
  const { state, observation, seat } = setup;
  if (observation) return { phase: 'playing', ...sanitizePlayerObservation(observation) };
  if (state) return { ...observeDecision(state, seat) };
  throw new Error(`场景 ${scenario.id} 没有决策观察`);
}

export function evaluationConfig(engine: DecisionEngine, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const e = engine as unknown as Record<string, any>;
  const options = e.getOptions?.() ?? e;
  const config: Record<string, unknown> = { engineType: engine.type };
  // 白名单避免 apiKey、客户端对象、函数与网络认证信息进入产物。
  for (const key of ['model', 'protocol', 'responseFormat', 'reasoningEffort', 'timeoutMs',
    'maxRetries', 'disableBidAdvice', 'maxConcurrency', 'enableDevMockOnFailure', 'enableFallbackOnFailure']) {
    if (options[key] !== undefined) config[key] = options[key];
  }
  if (e.config) config.search = { ...e.config };
  if (e.baseUrl) config.endpoint = String(e.baseUrl).replace(/\/+$/, '').split('?')[0].replace(/(https?:\/\/)[^/@]+@/, '$1');
  return { ...config, ...extra };
}

export function compatibleSummary(summary: BenchmarkReportSummary, identity: {
  dataHash: string; configHash: string; codeHash?: string;
}): boolean {
  return summary.suiteVersion === SUITE_VERSION && summary.dataHash === identity.dataHash
    && summary.configHash === identity.configHash && summary.codeHash === identity.codeHash;
}
