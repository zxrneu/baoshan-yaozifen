/**
 * 决策引擎模块组合根与导出。
 */
import { AlgorithmEngine } from './algorithmEngine';
import { BridgeEngine } from '../bridge/bridgeEngine';
import { DecisionEngine, EngineType } from './engineTypes';
import { LayaEngine, LayaEngineOptions } from './layaEngine';
import { LlmEngine, LlmEngineOptions } from './llmEngine';
import { RemoteDecisionEngine } from './remoteEngine';
import { EnginePlayerAgent } from './engineAdapter';
import { decisionLogger } from './decisionLogger';
import { loadEngineSettings, applySettingsToManager } from './engineSettings';

export * from './engineTypes';
export * from './decisionLogger';
export * from './thinkingService';
export * from './algorithmEngine';
export * from './llmEngine';
export * from './layaEngine';
export * from './remoteEngine';
export * from './engineAdapter';
export * from './engineSettings';
export * from './llm/llmPrompts';
export * from './llm/llmParser';
export * from './llm/llmEvaluator';
export * from './llm/llmClient';
export * from '../bridge';

export interface EngineManagerConfig {
  defaultType?: EngineType;
  useServerDecision?: boolean;
  layaOptions?: LayaEngineOptions;
  llmOptions?: LlmEngineOptions;
}

export class DecisionEngineManager {
  private listeners = new Set<() => void>();
  private activeType: EngineType;
  private useServerDecision: boolean;
  private readonly bridgeEngine: BridgeEngine;
  private readonly algorithmEngine: AlgorithmEngine;
  private layaEngine: LayaEngine;
  private llmEngine: LlmEngine;
  private remoteEngine: RemoteDecisionEngine;
  private readonly agent: EnginePlayerAgent;

  constructor(config: EngineManagerConfig = {}) {
    this.activeType = config.defaultType ?? 'bridge';
    this.useServerDecision = config.useServerDecision ?? true;
    this.bridgeEngine = new BridgeEngine();
    this.algorithmEngine = new AlgorithmEngine();
    this.layaEngine = new LayaEngine(config.layaOptions);
    this.llmEngine = new LlmEngine(config.llmOptions);
    this.remoteEngine = new RemoteDecisionEngine({
      targetEngineType: this.activeType,
      fallbackEngine: this.bridgeEngine,
    });

    const active = this.useServerDecision
      ? this.remoteEngine
      : this.getEngine(this.activeType);

    this.agent = new EnginePlayerAgent({
      engine: active,
      fallbackEngine: this.bridgeEngine,
      logger: decisionLogger,
    });
    this.refresh();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private refresh(): void {
    const { model, timeoutMs, protocol, responseFormat, reasoningEffort } = this.llmEngine.getOptions();
    this.remoteEngine = new RemoteDecisionEngine({ targetEngineType: this.activeType,
      fallbackEngine: this.bridgeEngine, timeoutMs: (timeoutMs ?? 60000) + 5000,
      decisionOptions: this.activeType === 'llm' ? { model, timeoutMs, protocol, responseFormat, reasoningEffort } : undefined });
    this.agent.setEngine(this.useServerDecision ? this.remoteEngine : this.getEngine(this.activeType));
    this.listeners.forEach(listener => listener());
  }

  isUseServerDecision(): boolean {
    return this.useServerDecision;
  }

  setUseServerDecision(enabled: boolean): void {
    this.useServerDecision = enabled;
    this.refresh();
  }

  getActiveType(): EngineType {
    return this.activeType;
  }

  setActiveType(type: EngineType): void {
    this.activeType = type;
    this.refresh();
  }

  updateLlmOptions(options: Partial<LlmEngineOptions>): void {
    const { client: _client, ...base } = this.llmEngine.getOptions();
    this.llmEngine = new LlmEngine({ ...base, ...options });
    this.refresh();
  }

  updateLayaOptions(options: Partial<LayaEngineOptions>): void {
    this.layaEngine = new LayaEngine({ ...this.layaEngine.getOptions(), ...options });
    this.refresh();
  }

  getLlmOptions(): LlmEngineOptions {
    return this.llmEngine.getOptions();
  }

  getLayaOptions(): LayaEngineOptions {
    return this.layaEngine.getOptions();
  }

  getEngine(type: EngineType): DecisionEngine {
    switch (type) {
      case 'bridge':
        return this.bridgeEngine;
      case 'algorithm':
        return this.algorithmEngine;
      case 'laya':
        return this.layaEngine;
      case 'llm':
        return this.llmEngine;
    }
  }

  getRemoteEngine(): RemoteDecisionEngine {
    return this.remoteEngine;
  }

  getAgent(): EnginePlayerAgent {
    return this.agent;
  }
}

export const defaultEngineManager = new DecisionEngineManager();
applySettingsToManager(loadEngineSettings(), defaultEngineManager);
