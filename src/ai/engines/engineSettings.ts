/**
 * 决策引擎前端配置模型与持久化管理。
 * 支持在设置中配置：
 * - 全阶段服务端决策架构 (Client/Server 推荐模式 vs 本地离线模式)
 * - vLLM 部署的 qwen38_27b (openai_api_base 与 model_name)
 * - TypeSafe /v1/systemone 的 api 地址与模型名
 * - 本地代理模式 vs 直连模式
 */
import { EngineType } from './engineTypes';
import { ReasoningEffort, LlmResponseFormat } from './llmEngine';
import { DecisionEngineManager } from './index';

export const DEFAULT_GOD_MODE: boolean =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ENABLE_GOD_MODE === 'true') || false;

export const IS_TAURI_APP: boolean =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export interface EngineSettings {
  activeType: EngineType;
  useProxy: boolean;
  useServerDecision: boolean; // 客户端/服务端全阶段决策架构 (默认开启)
  godMode?: boolean;
  llm: {
    baseUrl: string;
    model: string;
    apiKey: string;
    protocol: 'chat' | 'completion';
    reasoningEffort: ReasoningEffort;
    responseFormat?: LlmResponseFormat;
    timeoutMs: number;
  };
  laya: {
    baseUrl: string;
    model: string;
    timeoutMs: number;
  };
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  activeType: 'bridge',
  useProxy: !IS_TAURI_APP,
  useServerDecision: !IS_TAURI_APP, // 浏览器环境默认开启 C/S 决策，Tauri 原生单机默认直连本地 BridgeEngine
  godMode: DEFAULT_GOD_MODE,
  llm: {
    baseUrl: 'http://127.0.0.1:8000/v1/',
    model: 'qwen38_27b',
    apiKey: '',
    protocol: 'chat',
    reasoningEffort: 'default',
    responseFormat: 'json_object',
    timeoutMs: 60000,
  },
  laya: {
    baseUrl: 'http://127.0.0.1:11435',
    model: 'laya:multilingual',
    timeoutMs: 1500,
  },
};

const STORAGE_KEY = 'baoshan_engine_settings_v1';

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function loadEngineSettings(): EngineSettings {
  try {
    const storage = getSafeStorage();
    if (!storage) return DEFAULT_ENGINE_SETTINGS;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ENGINE_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      activeType: parsed.activeType ?? DEFAULT_ENGINE_SETTINGS.activeType,
      useProxy: parsed.useProxy ?? DEFAULT_ENGINE_SETTINGS.useProxy,
      useServerDecision:
        typeof parsed.useServerDecision === 'boolean'
          ? parsed.useServerDecision
          : DEFAULT_ENGINE_SETTINGS.useServerDecision,
      godMode: typeof parsed.godMode === 'boolean' ? parsed.godMode : DEFAULT_GOD_MODE,
      llm: {
        baseUrl: parsed.llm?.baseUrl || DEFAULT_ENGINE_SETTINGS.llm.baseUrl,
        model: parsed.llm?.model || DEFAULT_ENGINE_SETTINGS.llm.model,
        apiKey: parsed.llm?.apiKey ?? DEFAULT_ENGINE_SETTINGS.llm.apiKey,
        protocol: parsed.llm?.protocol || DEFAULT_ENGINE_SETTINGS.llm.protocol,
        reasoningEffort: parsed.llm?.reasoningEffort || DEFAULT_ENGINE_SETTINGS.llm.reasoningEffort,
        responseFormat: ['json_object', 'json_schema', 'text'].includes(parsed.llm?.responseFormat)
          ? parsed.llm.responseFormat : 'json_object',
        timeoutMs: Number(parsed.llm?.timeoutMs) || DEFAULT_ENGINE_SETTINGS.llm.timeoutMs,
      },
      laya: {
        baseUrl: parsed.laya?.baseUrl || DEFAULT_ENGINE_SETTINGS.laya.baseUrl,
        model: parsed.laya?.model || DEFAULT_ENGINE_SETTINGS.laya.model,
        timeoutMs: Number(parsed.laya?.timeoutMs) || DEFAULT_ENGINE_SETTINGS.laya.timeoutMs,
      },
    };
  } catch {
    return DEFAULT_ENGINE_SETTINGS;
  }
}

export function saveEngineSettings(settings: EngineSettings): void {
  try {
    const storage = getSafeStorage();
    if (storage) {
      storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch (e) {
    console.warn('保存引擎配置失败:', e);
  }
}

export function applySettingsToManager(
  settings: EngineSettings,
  manager: DecisionEngineManager,
): void {
  manager.setUseServerDecision(settings.useServerDecision ?? true);
  manager.setActiveType(settings.activeType);

  const llmBaseUrl = settings.useProxy
    ? '/api/llm'
    : settings.llm.baseUrl.replace(/\/+$/, '');
  manager.updateLlmOptions({
    baseUrl: llmBaseUrl,
    model: settings.llm.model,
    apiKey: settings.llm.apiKey || undefined,
    protocol: settings.llm.protocol,
    reasoningEffort: settings.llm.reasoningEffort,
    responseFormat: settings.llm.responseFormat ?? 'json_object',
    timeoutMs: settings.llm.timeoutMs,
  });

  const layaBaseUrl = settings.useProxy
    ? '/api/laya'
    : settings.laya.baseUrl.replace(/\/+$/, '');
  manager.updateLayaOptions({
    baseUrl: layaBaseUrl,
    model: settings.laya.model,
    timeoutMs: settings.laya.timeoutMs,
  });
}
