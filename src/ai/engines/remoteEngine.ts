/**
 * 客户端远程决策引擎 (SOLID - LSP / DIP 原则)。
 * 实现 DecisionEngine 接口，将出牌与全阶段决策统一委托给服务端 /api/decision。
 * 支持网络超时保护、取消信号传递与客户端本地桥牌算法保底。
 */
import { Card } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import {
  DecisionEngine, EngineDecision, ActionDecision, EngineType,
  ThinkingCallback, bindSafeFetch, safeAnySignal,
} from './engineTypes';
import { GameState, legalMoves } from '../../engine';
import { observePlayer } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { BridgeEngine } from '../bridge/bridgeEngine';
import { readEventStream } from './eventStream';
import { DecisionRequest, DecisionResponse, DecisionPhase, DecisionStreamEvent } from './decisionProtocol';

export interface RemoteEngineOptions {
  baseUrl?: string;
  targetEngineType?: EngineType;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  fallbackEngine?: DecisionEngine;
  decisionOptions?: DecisionRequest['options'];
}

export class RemoteDecisionEngine implements DecisionEngine {
  private decisionOptions?: DecisionRequest['options'];
  private baseUrl: string;
  private targetEngineType: EngineType;
  private timeoutMs: number;
  private fetchFn: typeof fetch;
  private fallbackEngine: DecisionEngine;

  constructor(options: RemoteEngineOptions = {}) {
    this.decisionOptions = options.decisionOptions;
    this.targetEngineType = options.targetEngineType ?? 'laya';
    this.baseUrl = options.baseUrl ?? '/api/decision';
    this.timeoutMs = options.timeoutMs ?? 65000;
    this.fetchFn = bindSafeFetch(options.fetchFn);
    this.fallbackEngine = options.fallbackEngine ?? new BridgeEngine();
  }

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
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: this.targetEngineType,
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
      };
    }

    const payload: DecisionRequest = {
      seat: observation.seat,
      phase: 'playing',
      engineType: this.targetEngineType,
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
      const res = await this.fetchFn(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: combinedSignal,
      });

      if (!res.ok) {
        throw new Error(`服务端决策接口返回 HTTP ${res.status} (${res.statusText})`);
      }

      const json = await this.readResponse(res, combinedSignal, options?.onThinkingProgress);
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
        fallbackReason: `客户端从服务端 ${this.targetEngineType} 回退: ${errorMsg}`,
        errorDetails: errorMsg,
      };
    } finally {
      clearTimeout(timer);
      cleanup();
    }
  }

  async chooseAction(
    state: GameState,
    seat: number,
    signal?: AbortSignal,
    options?: { onThinkingProgress?: ThinkingCallback },
  ): Promise<ActionDecision> {
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
    const started = performance.now();
    const isPlaying = state.phase === 'playing';
    const observation = isPlaying ? observePlayer(state, seat) : undefined;
    const candidates = isPlaying ? pruneCandidates(observation!, legalMoves(state, seat)) : undefined;

    const payload: DecisionRequest = {
      seat,
      phase: state.phase as DecisionPhase,
      engineType: this.targetEngineType,
      gameStateSnapshot: state,
      options: this.decisionOptions,
      stream: this.targetEngineType === 'llm' && !!options?.onThinkingProgress ? true : undefined,
      observation,
      candidates,
    };

    const timeoutController = new AbortController();
    const timer = setTimeout(() => {
      timeoutController.abort(new DOMException(`服务端决策调用超时 (${this.timeoutMs}ms)`, 'TimeoutError'));
    }, this.timeoutMs);
    const { signal: combinedSignal, cleanup } = safeAnySignal([signal, timeoutController.signal]);

    try {
      const res = await this.fetchFn(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: combinedSignal,
      });

      if (!res.ok) {
        throw new Error(`服务端动作接口返回 HTTP ${res.status}`);
      }

      const json = await this.readResponse(res, combinedSignal, options?.onThinkingProgress);
      if (!json.success || !json.action) {
        throw new Error(json.error || '服务端动作返回缺失有效结果');
      }

      return {
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
        const fb = await this.fallbackEngine.chooseAction(state, seat, signal, options);
        return {
          ...fb,
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

  async chooseBid(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    return this.chooseAction(state, seat, signal);
  }

  async chooseTrump(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    return this.chooseAction(state, seat, signal);
  }

  async chooseBury(state: GameState, seat: number, signal?: AbortSignal): Promise<ActionDecision> {
    return this.chooseAction(state, seat, signal);
  }
}
