/** 服务端仅分发白名单观察；模型失败时备用引擎使用同一份可见输入。 */
import { DecisionRequest, DecisionResponse } from '../types';
import { sanitizeDecisionRequest } from '../../src/ai/engines/decisionProtocol';
import { DecisionEngine, ActionDecision, ThinkingCallback } from '../../src/ai/engines/engineTypes';
import { BridgeEngine } from '../../src/ai/bridge/bridgeEngine';
import { ServerEngineRegistry } from '../engines/serverEngineRegistry';
import { cardId, cardPoints } from '../../src/cards';

export class DecisionService {
  constructor(private readonly registry: ServerEngineRegistry,
    private readonly defaultFallbackEngine: DecisionEngine = new BridgeEngine()) {}

  async processDecision(request: DecisionRequest, signal?: AbortSignal,
    onThinkingProgress?: ThinkingCallback): Promise<DecisionResponse> {
    request = sanitizeDecisionRequest(request);
    const started = performance.now();
    const primary = this.registry.forRequest(request.engineType, request.options);
    const fallback = request.fallbackEngine ? this.registry.get(request.fallbackEngine) : this.defaultFallbackEngine;
    const invoke = async (engine: DecisionEngine): Promise<ActionDecision> => {
      if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
      const options = { onThinkingProgress };
      // 主引擎和回退分别复制，避免前一次调用修改观察影响下一次调用。
      const input = sanitizeDecisionRequest(request);
      let result: ActionDecision;
      if (input.phase === 'playing') {
        const candidates = input.candidates;
        const decision = candidates.length === 1
          ? { card: candidates[0], engineType: engine.type, latencyMs: 0, diagnostic: '唯一候选直接出牌' }
          : await engine.chooseCard(input.observation, candidates, signal, options);
        result = { ...decision, decision, action: { kind: 'play', seat: input.seat, card: decision.card } };
      } else if (input.phase === 'bidding' && engine.chooseBid) {
        result = await engine.chooseBid(input.observation, signal, options);
      } else if (input.phase === 'trump' && engine.chooseTrump) {
        result = await engine.chooseTrump(input.observation, signal, options);
      } else if (input.phase === 'bury' && engine.chooseBury) {
        result = await engine.chooseBury(input.observation, signal, options);
      } else if (engine.chooseAction) {
        result = await engine.chooseAction(input.observation, signal, options);
      } else {
        result = await new BridgeEngine().chooseAction(input.observation, signal);
      }
      if (signal?.aborted) throw signal.reason ?? new DOMException('已取消决策', 'AbortError');
      this.validateAction(request, result);
      return result;
    };
    let result: ActionDecision;
    try { result = await invoke(primary); }
    catch (error) {
      if (signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      result = await invoke(fallback);
      result = { ...result, fallbackReason: `服务端自 ${primary.type} 降级: ${reason}`, errorDetails: reason };
      if (result.decision) result.decision = { ...result.decision, fallbackReason: result.fallbackReason, errorDetails: reason };
    }
    return { ...result, success: true, latencyMs: performance.now() - started, executionEnvironment: 'server' };
  }

  private validateAction(request: DecisionRequest, result: ActionDecision): void {
    const action = result.action;
    if (!action || action.seat !== request.seat) throw new Error('引擎返回了错误座位');
    if (request.phase === 'playing' && action.kind === 'play'
      && request.candidates.some(card => cardId(card) === cardId(action.card))) return;
    if (request.phase === 'bidding' && action.kind === 'bid'
      && (action.bid === null || request.observation.legalBids.includes(action.bid))) return;
    if (request.phase === 'trump' && action.kind === 'trump'
      && ['S', 'H', 'D', 'C'].includes(action.trump)) return;
    if (request.phase === 'bury' && action.kind === 'bury'
      && action.cards.length === request.observation.kittySize
      && new Set(action.cards.map(cardId)).size === action.cards.length
      && action.cards.every(card => cardPoints(card) === 0
        && request.observation.ownHand.some(own => cardId(own) === cardId(card)))) return;
    throw new Error('引擎返回了非法阶段动作');
  }
}
