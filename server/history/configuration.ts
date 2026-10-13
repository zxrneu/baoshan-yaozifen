/** 默认配置存档解析（SRP）：从决策注册表采集服务端真实参数，浏览器请求值不能冒充生效配置。 */
import type { HistoryWrite } from '../../src/history/transport';
import { contentDigest, isRecord } from '../../src/history/protocol';
import { derivedHistoryId } from '../../src/history/ids';
import { LLM_PROMPT_VERSION } from '../../src/ai/engines/llm/llmPrompts';
import { LlmEngine } from '../../src/ai/engines/llmEngine';
import { LayaEngine } from '../../src/ai/engines/layaEngine';
import type { DecisionRequest } from '../../src/ai/engines/decisionProtocol';
import type { ServerEngineRegistry } from '../engines/serverEngineRegistry';
import { PROFILE_IMPLEMENTATION_VERSION } from '../../src/ai/engines/profiles';
import { assertSafeValue } from './validation';

export function resolveHistoryConfiguration(packet: HistoryWrite, registry: ServerEngineRegistry): HistoryWrite {
  const ids = new Map<string,string>();
  packet.profiles = packet.profiles?.map(profile => {
    assertSafeValue(profile, '配置快照');
    if (profile.implementationVersion === PROFILE_IMPLEMENTATION_VERSION) {
      if (profile.parameters.execution === 'local') return profile;
      const actual = registry.getProfile(profile.profileId, profile.version);
      if (actual.configHash !== profile.configHash || actual.profileVersionId !== profile.profileVersionId) throw new Error('保存配置与实际版本不一致');
      return actual;
    }
    if (profile.parameters.execution !== 'server' || !['llm','laya'].includes(profile.type)) return profile;
    const requested = isRecord(profile.parameters.options) ? profile.parameters.options : {};
    // 与 RemoteDecisionEngine 的 options 白名单相同，Laya 当前不会接收客户端覆盖。
    const overrides = Object.fromEntries(['model','protocol','responseFormat','reasoningEffort','timeoutMs'].filter(key => requested[key] !== undefined).map(key=>[key,requested[key]])) as DecisionRequest['options'];
    const engine = registry.forRequest(profile.type as 'llm' | 'laya', overrides);
    const options: Record<string,unknown> = {};
    if (engine instanceof LlmEngine) {
      const current = engine.getOptions();
      for (const key of ['model','protocol','responseFormat','reasoningEffort','timeoutMs','maxRetries','maxConcurrency','disableBidAdvice','enableDevMockOnFailure'] as const) options[key] = current[key];
      options.promptVersion=LLM_PROMPT_VERSION; options.serviceId=contentDigest(current.baseUrl); options.baseUrlEnv='LLM_BASE_URL'; options.apiKeyEnv='LLM_API_KEY';
    } else if (engine instanceof LayaEngine) {
      const current=engine.getOptions(); options.model=current.model; options.timeoutMs=current.timeoutMs; options.enableFallbackOnFailure=current.enableFallbackOnFailure;
      options.promptVersion=LLM_PROMPT_VERSION; options.serviceId=contentDigest(current.baseUrl); options.baseUrlEnv='LAYA_BASE_URL';
    }
    const parameters={execution:'server',options};
    const configHash=contentDigest({profileId:profile.profileId,name:profile.name,type:profile.type,parameters,implementationVersion:profile.implementationVersion});
    const profileVersionId=derivedHistoryId('profileVersion',configHash);
    if (profile.profileVersionId) ids.set(profile.profileVersionId,profileVersionId);
    return {...profile,parameters,configHash,version:configHash,profileVersionId};
  });
  const remap = <T extends { profileVersionId?: string | null }>(value:T):T => ({...value,profileVersionId:value.profileVersionId ? ids.get(value.profileVersionId) ?? value.profileVersionId : value.profileVersionId});
  packet.assignments=packet.assignments?.map(remap); packet.evaluations=packet.evaluations?.map(remap);
  if (packet.commit) {
    packet.commit.seatAssignments=packet.commit.seatAssignments?.map(remap);
    if(packet.commit.evaluation) packet.commit.evaluation=remap(packet.commit.evaluation);
  }
  return packet;
}
