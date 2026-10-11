/**
 * 服务端决策引擎注册中心 (SOLID - OCP / DIP 原则)。
 * 管理所有服务端引擎实例（Bridge、Algorithm、Laya、LLM、RL），支持按需扩展与动态注入配置。
 */
import { DecisionEngine, EngineType } from '../../src/ai/engines/engineTypes';
import { BridgeEngine } from '../../src/ai/bridge/bridgeEngine';
import { AlgorithmEngine } from '../../src/ai/engines/algorithmEngine';
import { LayaEngine } from '../../src/ai/engines/layaEngine';
import type { DecisionRequest } from '../../src/ai/engines/decisionProtocol';
import { LlmEngine } from '../../src/ai/engines/llmEngine';

export interface ServerEngineConfig {
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
  };
}

export class ServerEngineRegistry {
  private readonly engines = new Map<EngineType, DecisionEngine>();

  constructor(config: ServerEngineConfig = {}) {
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
        enableDevMockOnFailure: false,
      }),
    );
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
