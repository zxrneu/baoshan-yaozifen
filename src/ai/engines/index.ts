/**
 * 决策引擎模块组合根与导出。
 */
import { AlgorithmEngine } from './algorithmEngine';
import { BridgeEngine } from '../bridge/bridgeEngine';
import { DecisionEngine, EngineType } from './engineTypes';
import { LayaEngine, LayaEngineOptions } from './layaEngine';
import { LlmEngine, LlmEngineOptions } from './llmEngine';
import { EnginePlayerAgent } from './engineAdapter';
import { decisionLogger } from './decisionLogger';
import { loadEngineSettings, applySettingsToManager } from './engineSettings';

export * from './engineTypes';
export * from './decisionLogger';
export * from './algorithmEngine';
export * from './llmEngine';
export * from './layaEngine';
export * from './engineAdapter';
export * from './engineSettings';
export * from '../bridge';

export interface EngineManagerConfig {
  defaultType?: EngineType;
  layaOptions?: LayaEngineOptions;
  llmOptions?: LlmEngineOptions;
}

export class DecisionEngineManager {
  private activeType: EngineType;
  private readonly bridgeEngine: BridgeEngine;
  private readonly algorithmEngine: AlgorithmEngine;
  private readonly layaEngine: LayaEngine;
  private readonly llmEngine: LlmEngine;
  private readonly agent: EnginePlayerAgent;

  constructor(config: EngineManagerConfig = {}) {
    this.activeType = config.defaultType ?? 'bridge';
    this.bridgeEngine = new BridgeEngine();
    this.algorithmEngine = new AlgorithmEngine();
    this.layaEngine = new LayaEngine(config.layaOptions);
    this.llmEngine = new LlmEngine(config.llmOptions);

    this.agent = new EnginePlayerAgent({
      engine: this.getEngine(this.activeType),
      fallbackEngine: this.bridgeEngine,
      logger: decisionLogger,
    });
  }

  getActiveType(): EngineType {
    return this.activeType;
  }

  setActiveType(type: EngineType): void {
    this.activeType = type;
    this.agent.setEngine(this.getEngine(type));
  }

  updateLlmOptions(options: Partial<LlmEngineOptions>): void {
    this.llmEngine.updateOptions(options);
  }

  updateLayaOptions(options: Partial<LayaEngineOptions>): void {
    this.layaEngine.updateOptions(options);
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

  getAgent(): EnginePlayerAgent {
    return this.agent;
  }
}

export const defaultEngineManager = new DecisionEngineManager();
applySettingsToManager(loadEngineSettings(), defaultEngineManager);
