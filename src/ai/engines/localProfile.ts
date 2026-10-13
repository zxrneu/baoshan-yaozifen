/** 本地配置适配器（DIP）：已有参数传入真实搜索实例，决策附带冻结版本。 */
import { BridgeEngine } from '../bridge/bridgeEngine';
import type { BridgeThinkingConfig } from '../bridge/types';
import { AlgorithmEngine } from './algorithmEngine';
import { WorkerCardSelector } from '../optimized/workerClient';
import type { OptimizedBudget } from '../optimized/contracts';
import type { DecisionEngine, ActionDecision, EngineDecision } from './engineTypes';
import type { EngineProfile } from './profiles';

export function localProfileEngine(profile: EngineProfile): DecisionEngine {
  const engine: DecisionEngine | undefined = profile.type === 'bridge' ? new BridgeEngine({ config: profile.parameters.options as unknown as BridgeThinkingConfig })
    : profile.type === 'algorithm' ? new AlgorithmEngine(new WorkerCardSelector({ budget: profile.parameters.options as unknown as OptimizedBudget, timeoutMs: Number(profile.parameters.options.timeLimitMs) + 1000 }))
    : undefined;
  if (!engine) throw new Error('模型配置需要通过服务端解析环境引用，请开启服务端决策');
  const ref = { profileId: profile.profileId, version: profile.version };
  function tag<T extends ActionDecision | EngineDecision>(result: T, phase: string): T {
    const metadata = { requestedProfile: ref, actualProfile: ref, fallbackChain: [], decisionSource: 'diagnostic' in result && result.diagnostic === '唯一候选直接出牌' ? 'deterministic' as const : result.fallbackReason ? 'heuristic' as const : profile.parameters.capabilities[phase] };
    return { ...result, ...metadata, ...('decision' in result && result.decision ? { decision: { ...result.decision, ...metadata } } : {}) };
  }
  return { type: profile.type, profileReference: ref,
    chooseCard: async (...args) => tag(await engine.chooseCard(...args), 'playing'),
    chooseAction: async (...args) => tag(await engine.chooseAction!(...args), args[0].phase),
  };
}
