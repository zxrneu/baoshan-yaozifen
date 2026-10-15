/**
 * 服务端决策引擎注册中心 (SOLID - OCP / DIP 原则)。
 * 管理所有服务端引擎实例（Bridge、Algorithm、Laya、LLM、RL），支持按需扩展与动态注入配置。
 */
import { DecisionEngine, EngineType } from '../../src/ai/engines/engineTypes';
import { ENGINE_LABELS } from '../../src/ai/engines/engineLabels';
import { BridgePimcEvaluator } from '../../src/ai/bridge/pimc';
import { seededSearchRandom } from '../../src/ai/optimized/computation';
import { BridgeEngine } from '../../src/ai/bridge/bridgeEngine';
import { AlgorithmEngine } from '../../src/ai/engines/algorithmEngine';
import { LayaEngine } from '../../src/ai/engines/layaEngine';
import type { DecisionRequest } from '../../src/ai/engines/decisionProtocol';
import { LlmEngine } from '../../src/ai/engines/llmEngine';
import { derivedHistoryId } from '../../src/history/ids';
import { ProfileStore } from './profileStore';
import type { EngineProfile, ProfilesFile } from '../../src/ai/engines/profiles';
import type { BridgeThinkingConfig } from '../../src/ai/bridge/types';
import type { OptimizedBudget } from '../../src/ai/optimized/contracts';
import { createOptimizedSelector } from '../../src/ai/optimized';

const REASONING_EFFORTS = ['default', 'none', 'low', 'medium', 'high'] as const;
type ReasoningEffortName = typeof REASONING_EFFORTS[number];

/**
 * 从环境变量解析 LLM 的补全参数（token 上限与思考链档位）。
 * 非法值一律忽略并回落默认，避免把无效参数发到服务端（容错优于中断）。
 */
function llmCompletionEnv(env?: Record<string, string | undefined>): {
  maxTokens?: number;
  reasoningEffort: ReasoningEffortName;
} {
  const rawTokens = env?.LLM_MAX_TOKENS?.trim();
  const parsedTokens = rawTokens ? Number(rawTokens) : NaN;
  const maxTokens = Number.isInteger(parsedTokens) && parsedTokens > 0 ? parsedTokens : undefined;
  const rawEffort = env?.LLM_REASONING_EFFORT?.trim().toLowerCase();
  const reasoningEffort = REASONING_EFFORTS.includes(rawEffort as ReasoningEffortName)
    ? (rawEffort as ReasoningEffortName)
    : 'low';
  // 未配置时不带该键：档案 schema 会把 undefined 判为非法数值。
  return maxTokens === undefined ? { reasoningEffort } : { maxTokens, reasoningEffort };
}

export interface ServerEngineConfig {
  profilesPath?: string;
  env?: Record<string, string | undefined>;
  laya?: {
    baseUrl?: string;
    model?: string;
    timeoutMs?: number;
  };
  llm?: {
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    protocol?: 'chat' | 'completion';
    timeoutMs?: number;
    maxTokens?: number;
    reasoningEffort?: 'default' | 'none' | 'low' | 'medium' | 'high';
  };
}

export class ServerEngineRegistry {
  private profileLoader?: (id: string) => import('../../src/history/contracts').ProfileVersionInput | null;
  readonly profiles: ProfileStore;
  private readonly profileEngines = new Map<string, DecisionEngine>();
  private readonly engines = new Map<EngineType, DecisionEngine>();

  constructor(config: ServerEngineConfig = {}) {
    const defaults: ProfilesFile = { schemaVersion: 1, profiles: [
      { id: 'default-bridge', name: ENGINE_LABELS.bridge, type: 'bridge', options: {} },
      { id: 'default-algorithm', name: ENGINE_LABELS.algorithm, type: 'algorithm', options: {}, fallbackProfileId: 'default-bridge' },
      { id: 'default-laya', name: ENGINE_LABELS.laya, type: 'laya', options: { model: config.laya?.model ?? 'laya:multilingual', timeoutMs: config.laya?.timeoutMs ?? 2500 }, fallbackProfileId: 'default-bridge' },
      { id: 'default-llm', name: ENGINE_LABELS.llm, type: 'llm', options: { model: config.llm?.model ?? 'qwen38_27b', protocol: config.llm?.protocol ?? 'chat', timeoutMs: config.llm?.timeoutMs ?? 60000, ...llmCompletionEnv(config.env) }, fallbackProfileId: 'default-bridge' },
    ] };
    this.profiles = new ProfileStore(defaults, { ...config.env, ...(config.llm?.baseUrl ? { LLM_BASE_URL: config.llm.baseUrl } : {}), ...(config.llm?.apiKey ? { LLM_API_KEY: config.llm.apiKey } : {}), ...(config.laya?.baseUrl ? { LAYA_BASE_URL: config.laya.baseUrl } : {}) }, config.profilesPath);
    // 注册桥牌专家深度思考引擎（核心保底与极速计算）
    this.engines.set('bridge', new BridgeEngine());

    // 注册约束蒙特卡洛算法引擎
    this.engines.set('algorithm', new AlgorithmEngine());

    // 注册 Laya 非自回归模型引擎（服务端直连 Ollaya，无浏览器跨域与 PNA 限制）
    this.engines.set(
      'laya',
      new LayaEngine({
        baseUrl: config.laya?.baseUrl || 'http://127.0.0.1:11435',
        model: config.laya?.model || 'laya:multilingual',
        timeoutMs: config.laya?.timeoutMs || 2500, // 服务端宽裕超时 2.5s
      }),
    );

    // 注册大语言模型引擎（服务端自动注入 API Key）
    this.engines.set(
      'llm',
      new LlmEngine({
        baseUrl: config.llm?.baseUrl || 'http://127.0.0.1:8000/v1/',
        apiKey: config.llm?.apiKey,
        model: config.llm?.model || 'qwen38_27b',
        protocol: config.llm?.protocol || 'chat',
        timeoutMs: config.llm?.timeoutMs || 60000,
        ...llmCompletionEnv(config.env),
        enableDevMockOnFailure: false,
      }),
    );
  }

  setProfileLoader(loader: (id: string) => import('../../src/history/contracts').ProfileVersionInput | null): void { this.profileLoader = loader; }
  getProfile(id: string, version?: string): EngineProfile {
    if (version && !this.profiles.versions.has(version)) {
      const stored = this.profileLoader?.(importProfileId(version));
      if (stored && stored.profileId === id) this.profiles.restore(stored);
    }
    return structuredClone(this.profiles.get(id, version).profile);
  }

  forProfile(id: string, version: string, searchSeed?: number): DecisionEngine {
    this.getProfile(id, version);
    const resolved = this.profiles.get(id, version);
    const { profile, baseUrl, apiKey } = resolved;
    const seededSearch = searchSeed !== undefined && (profile.type === 'bridge' || profile.type === 'algorithm');
    const cached = this.profileEngines.get(version); if (cached && !seededSearch) return cached;
    const options = profile.parameters.options;
    let engine: DecisionEngine;
    switch (profile.type) {
      case 'bridge': { const config=options as unknown as BridgeThinkingConfig; engine = new BridgeEngine({ config, ...(searchSeed === undefined ? {} : {pimcEvaluator:new BridgePimcEvaluator({config,random:()=>seededSearchRandom(searchSeed)})}) }); break; }
      case 'algorithm': {
        const selector = createOptimizedSelector({ budget: options as unknown as OptimizedBudget, ...(searchSeed === undefined ? {} : {dependencies:{random:()=>seededSearchRandom(searchSeed)}}) });
        engine = new AlgorithmEngine({ choose: async (observation, signal) => {
          if (signal?.aborted) throw signal.reason;
          const result = selector.choose(observation);
          if (signal?.aborted) throw signal.reason;
          return result;
        } }); break;
      }
      case 'llm': engine = new LlmEngine({ ...options, baseUrl, apiKey, enableDevMockOnFailure: false, enableFallbackOnFailure: false }); break;
      case 'laya': engine = new LayaEngine({ ...options, baseUrl, apiKey, enableFallbackOnFailure: false }); break;
    }
    if(!seededSearch)this.profileEngines.set(version, engine); return engine;
  }

  get(type: EngineType): DecisionEngine {
    const engine = this.engines.get(type);
    if (!engine) {
      console.warn(`[ServerEngineRegistry] 未知引擎类型: ${type}，自动降级为 bridge 引擎`);
      return this.engines.get('bridge')!;
    }
    return engine;
  }

  forRequest(type: EngineType, options?: DecisionRequest['options']): DecisionEngine {
    const engine = this.get(type);
    if (type !== 'llm' || !(engine instanceof LlmEngine) || !options) return engine;
    const { client: _client, ...base } = engine.getOptions();
    const { model, protocol, responseFormat, reasoningEffort, timeoutMs } = options;
    return new LlmEngine({ ...base,
      model: model ?? base.model, protocol: protocol ?? base.protocol,
      responseFormat: responseFormat ?? base.responseFormat, reasoningEffort: reasoningEffort ?? base.reasoningEffort,
      timeoutMs: Math.min(120000, Math.max(1000, timeoutMs ?? base.timeoutMs ?? 60000)),
    });
  }

  register(type: EngineType, engine: DecisionEngine): void {
    this.engines.set(type, engine);
  }

  has(type: EngineType): boolean {
    return this.engines.has(type);
  }
}

function importProfileId(version: string): string { return derivedHistoryId('profileVersion', version); }
