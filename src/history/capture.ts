/** 历史采集白名单（SRP）：版本化实际默认配置与阶段观察，不记录凭据或原始全局请求。 */
import type { DecisionEngineManager } from '../ai/engines';
import type { DecisionRecord } from '../ai/engines/engineTypes';
import { observeDecision } from '../ai/decisionObservation';
import type { GameState } from '../engine';
import { contentDigest } from './json';
import { derivedHistoryId, newHistoryId } from './ids';
import type { HistoryConfiguration } from './autosave';
import type { EvaluationRecord, ProfileVersionInput } from './contracts';
import { DEFAULT_DEEP_THINKING_CONFIG } from '../ai/bridge/types';
import { LLM_PROMPT_VERSION } from '../ai/engines/llm/llmPrompts';
import { DEFAULT_OPTIMIZED_BUDGET } from '../ai/optimized/contracts';

export function captureConfiguration(manager: DecisionEngineManager, debug: boolean): HistoryConfiguration {
  const routes = manager.getSeatRoutes();
  if (routes) {
    const profiles = manager.getHistoryProfiles();
    const defaultProfile = manager.getProfiles().find(profile => profile.type === manager.getActiveType()) ?? manager.getProfiles()[0];
    if (debug && defaultProfile && !profiles.some(profile => profile.profileVersionId === defaultProfile.profileVersionId)) profiles.push(defaultProfile);
    return { profiles, seats: routes.map((route, seat) => route === 'human' && !debug ? { seat, kind: 'human' as const } : { seat, kind: 'ai' as const, profileVersionId: route === 'human' ? defaultProfile?.profileVersionId : manager.getProfileVersion(route.version)?.profileVersionId }) };
  }
  const type = manager.getActiveType();
  const llm = manager.getLlmOptions(); const laya = manager.getLayaOptions();
  const parameters: Record<string, unknown> = { execution: manager.isUseServerDecision() ? 'server' : 'local',
    options: type === 'llm' ? { promptVersion:LLM_PROMPT_VERSION, model: llm.model, timeoutMs: llm.timeoutMs, protocol: llm.protocol, responseFormat: llm.responseFormat, reasoningEffort: llm.reasoningEffort, maxConcurrency:llm.maxConcurrency, maxRetries:llm.maxRetries, disableBidAdvice:llm.disableBidAdvice, enableDevMockOnFailure:llm.enableDevMockOnFailure,
      serviceId: contentDigest(llm.baseUrl ?? ''), baseUrlEnv: 'LLM_BASE_URL', apiKeyEnv: 'LLM_API_KEY' }
      : type === 'laya' ? { model: laya.model, timeoutMs: laya.timeoutMs, enableFallbackOnFailure:laya.enableFallbackOnFailure, serviceId: contentDigest(laya.baseUrl ?? ''), baseUrlEnv: 'LAYA_BASE_URL' }
      : type === 'bridge' ? DEFAULT_DEEP_THINKING_CONFIG : DEFAULT_OPTIMIZED_BUDGET };
  const configHash = contentDigest({ type, parameters, implementationVersion: 'default-engines-v1' });
  const profile: ProfileVersionInput = { profileVersionId: derivedHistoryId('profileVersion', configHash), profileId: `default-${type}`, version: configHash, configHash, type, name: `默认 ${type}`, parameters, implementationVersion: 'default-engines-v1', createdAt: Date.now() };
  const fallbackParameters={ execution:manager.isUseServerDecision() ? 'server' : 'local', options:DEFAULT_DEEP_THINKING_CONFIG };
  const fallbackHash=contentDigest({type:'bridge',parameters:fallbackParameters,implementationVersion:'default-engines-v1'});
  const fallback:ProfileVersionInput={profileVersionId:derivedHistoryId('profileVersion',fallbackHash),profileId:'default-bridge',version:fallbackHash,configHash:fallbackHash,type:'bridge',name:'默认 bridge',parameters:fallbackParameters,implementationVersion:'default-engines-v1',createdAt:Date.now()};
  return { profiles: type==='bridge' ? [profile] : [profile,fallback], seats: [0,1,2,3].map(seat => !debug && seat === 1 ? { seat, kind: 'human' } : { seat, kind: 'ai', profileVersionId: profile.profileVersionId }) };
}
export function safeDiagnostic(value?: string): string | undefined {
  return value?.replace(/https?:\/\/[^\s)]+/gi, '[服务地址已隐藏]').replace(/(?:bearer\s+\S+|\bsk-[a-z0-9_-]+)/gi, '[凭据已隐藏]');
}
export function captureEvaluation(record: DecisionRecord, state: GameState, profileVersionId?: string): Omit<EvaluationRecord, 'nodeId'> | null {
  if (!record.context || !record.action) return null;
  return { evaluationId: newHistoryId('evaluation'), requestId: record.context.requestId, sessionId: record.context.sessionId,
    seat: record.seat, phase: state.phase, purpose: record.context.purpose, observation: observeDecision(state, record.seat),
    candidates: record.candidateEvaluations ?? record.candidates, recommended: { requestedProfile: record.requestedProfile, actualProfile: record.actualProfile, fallbackChain: record.fallbackChain?.map(entry => ({ ...entry, reason: safeDiagnostic(entry.reason) })), decisionSource: record.decisionSource, action: record.action, requestedEngine:record.requestedEngine, conclusion: safeDiagnostic(record.conclusion), diagnostic: safeDiagnostic(record.diagnostic), inputVisibility: record.inputVisibility ? { ownHandCount:record.inputVisibility.ownHandCount, hiddenHandCount:record.inputVisibility.hiddenHandCount, kittyVisibility:record.inputVisibility.kitty, kittySize:record.inputVisibility.kittySize, revealedHand:record.inputVisibility.revealedHand } : undefined },
    status: 'evaluated', latencyMs: record.latencyMs, profileVersionId, modelName: safeDiagnostic(record.modelName), engineType: record.engineType,
    fallbackReason: safeDiagnostic(record.fallbackReason), errorDetails: safeDiagnostic(record.errorDetails), createdAt: record.timestamp };
}
