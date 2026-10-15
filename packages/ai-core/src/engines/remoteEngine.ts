/**
 * 客户端远程决策引擎 (SOLID - LSP / DIP 原则)。
 * 实现 DecisionEngine 接口，将出牌与全阶段决策统一委托给服务端 /api/decision。
 * 支持网络超时保护、取消信号传递与客户端本地桥牌算法保底。
 */
import { Card } from '@yaozifen/game-core/cards';
import { PlayerObservation } from '../optimized/contracts';
import {
  DecisionEngine, EngineDecision, ActionDecision, EngineType,
  ThinkingCallback, bindSafeFetch, safeAnySignal, abortable,
} from './engineTypes';
import { legalObservationCards } from '@yaozifen/game-view/observation';
import { DecisionObservation, BiddingObservation, TrumpObservation, BuryObservation, sanitizeDecisionObservation, sanitizePlayerObservation } from '@yaozifen/game-view/decisionObservation';
import { pruneCandidates } from '../tactics';
import { BridgeEngine } from '../bridge/bridgeEngine';
import { readEventStream } from './eventStream';
import { DecisionRequest, sanitizeDecisionRequest, DecisionResponse, DecisionStreamEvent } from './decisionProtocol';

export interface RemoteEngineOptions {
  profile?: import('./profiles').ProfileReference;
  totalBudgetMs?: number;
  baseUrl?: string;
  targetEngineType?: EngineType;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  fallbackEngine?: DecisionEngine;
  decisionOptions?: DecisionRequest['options'];
}

export class RemoteDecisionEngine implements DecisionEngine {
  private profile?: import('./profiles').ProfileReference;
  private totalBudgetMs?: number;
  private decisionOptions?: DecisionRequest['options'];
  private baseUrl: string;
  private targetEngineType: EngineType;
  private timeoutMs: number;
  private fetchFn: typeof fetch;
  private fallbackEngine: DecisionEngine;

  constructor(options: RemoteEngineOptions = {}) {
    this.profile = options.profile;
    this.totalBudgetMs = options.totalBudgetMs;
    this.decisionOptions = options.decisionOptions;
    this.targetEngineType = options.targetEngineType ?? 'laya';
    this.baseUrl = options.baseUrl ?? '/api/decision';
    this.timeoutMs = options.timeoutMs ?? (options.totalBudgetMs ? options.totalBudgetMs + 5000 : 65000);
    this.fetchFn = bindSafeFetch(options.fetchFn);
    this.fallbackEngine = options.fallbackEngine ?? new BridgeEngine();
  }

  private profilePayload() {
    return this.profile ? { profileId: this.profile.profileId, profileVersion: this.profile.version, totalBudgetMs: this.totalBudgetMs, requestId: globalThis.crypto.randomUUID() } : {};
  }

  get profileReference(): import('./profiles').ProfileReference | undefined { return this.profile ? { ...this.profile } : undefined; }

  get type(): EngineType {
    return this.targetEngineType;
  }

  getTargetEngineType(): EngineType {
    return this.targetEngineType;
  }

  setTargetEngineType(type: EngineType): void {
    this.targetEngineType = type;
  }

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
    options?: { onThinkingProgress?: ThinkingCallback },
  ): Promise<EngineDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    observation = sanitizePlayerObservation(observation);
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: this.targetEngineType,
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
        ...(this.profile ? { requestedProfile: this.profile, actualProfile: this.profile, decisionSource: 'deterministic' as const } : {}),
      };
    }

    const payload: DecisionRequest = {
      seat: observation.seat,
      phase: 'playing',
      engineType: this.targetEngineType,
      ...this.profilePayload(),
      options: this.decisionOptions,
      stream: this.targetEngineType === 'llm' && !!options?.onThinkingProgress ? true : undefined,
      observation,
      candidates: [...candidates],
    };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`服务端决策调用超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const res = await abortable(this.fetchFn(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizeDecisionRequest(payload)),
        signal: combinedSignal,
      }), combinedSignal);

      if (!res.ok) {
        throw new Error(`服务端决策接口返回 HTTP ${res.status} (${res.statusText})`);
      }

      const json = await abortable(this.readResponse(res, combinedSignal, options?.onThinkingProgress), combinedSignal);
      if (!json.success || !json.decision) {
        throw new Error(json.error || '服务端决策返回缺失有效结果');
      }

      return json.decision;
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[RemoteDecisionEngine] ⚠️ 服务端出牌请求失败: ${errorMsg}，由客户端本地桥牌算法保底接管`);

      const fb = await this.fallbackEngine.chooseCard(observation, candidates, signal, options);
      return {
        ...fb,
        ...(this.profile ? { requestedProfile: this.profile, fallbackChain: [{ profile: this.profile, reason: errorMsg }] } : {}),
        fallbackReason: `客户端从服务端 ${this.targetEngineType} 回退: ${errorMsg}`,
        errorDetails: errorMsg,
      };
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  async chooseAction(
    observation: DecisionObservation,
    signal?: AbortSignal,
    options?: { onThinkingProgress?: ThinkingCallback },
  ): Promise<ActionDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    const started = performance.now();
    observation = sanitizeDecisionObservation(observation);
    const { seat } = observation;
    if (observation.phase === 'playing') {
      const candidates = pruneCandidates(observation, legalObservationCards(observation));
      const decision = await this.chooseCard(observation, candidates, signal, options);
      return { ...decision, action: { kind: 'play', seat, card: decision.card }, decision };
    }

    const base = { seat, ...this.profilePayload(), engineType: this.targetEngineType, options: this.decisionOptions,
      stream: this.targetEngineType === 'llm' && !!options?.onThinkingProgress ? true : undefined };
    const payload: DecisionRequest = observation.phase === 'bidding'
      ? { ...base, phase: 'bidding', observation }
      : observation.phase === 'trump' ? { ...base, phase: 'trump', observation }
      : { ...base, phase: 'bury', observation };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`服务端决策调用超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const res = await abortable(this.fetchFn(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitizeDecisionRequest(payload)),
        signal: combinedSignal,
      }), combinedSignal);

      if (!res.ok) {
        throw new Error(`服务端动作接口返回 HTTP ${res.status}`);
      }

      const json = await abortable(this.readResponse(res, combinedSignal, options?.onThinkingProgress), combinedSignal);
      if (!json.success || !json.action) {
        throw new Error(json.error || '服务端动作返回缺失有效结果');
      }

      return {
        requestedProfile: json.requestedProfile, actualProfile: json.actualProfile, fallbackChain: json.fallbackChain, decisionSource: json.decisionSource,
        action: json.action,
        decision: json.decision,
        engineType: json.engineType,
        latencyMs: json.latencyMs ?? (performance.now() - started),
        thinking: json.thinking,
        conclusion: json.conclusion,
        fallbackReason: json.fallbackReason,
        modelName: json.modelName,
        confidence: json.confidence,
        rawOutput: json.rawOutput,
        requestPayload: json.requestPayload,
        errorDetails: json.errorDetails,
      };
    } catch (err: any) {
      if (signal?.aborted) throw err;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[RemoteDecisionEngine] ⚠️ 服务端动作接口异常: ${errorMsg}，由客户端本地引擎保底接管`);

      if (this.fallbackEngine.chooseAction) {
        const fb = await this.fallbackEngine.chooseAction(observation, signal, options);
        return {
          ...fb,
        ...(this.profile ? { requestedProfile: this.profile, fallbackChain: [{ profile: this.profile, reason: errorMsg }] } : {}),
          fallbackReason: `客户端从服务端 ${this.targetEngineType} 回退: ${errorMsg}`,
        };
      }

      throw err;
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  private async readResponse(response: Response, signal: AbortSignal, onProgress?: ThinkingCallback): Promise<DecisionResponse> {
    if (!response.headers?.get('content-type')?.includes('text/event-stream')) return response.json();
    for await (const data of readEventStream(response, signal)) {
      if (data === '[DONE]') break;
      const event: DecisionStreamEvent = JSON.parse(data);
      if (event.type === 'progress') onProgress?.(event.progress);
      else if (event.type === 'result') return event.response;
      else if (event.type === 'error') throw new Error(event.error);
    }
    throw new Error('服务端决策流提前结束，缺失完整结果');
  }

  async chooseBid(observation: BiddingObservation, signal?: AbortSignal): Promise<ActionDecision> {
    return this.chooseAction(observation, signal);
  }

  async chooseTrump(observation: TrumpObservation, signal?: AbortSignal): Promise<ActionDecision> {
    return this.chooseAction(observation, signal);
  }

  async chooseBury(observation: BuryObservation, signal?: AbortSignal): Promise<ActionDecision> {
    return this.chooseAction(observation, signal);
  }
}
