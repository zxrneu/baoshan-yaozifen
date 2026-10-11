/**
 * 保山幺子分 服务端与客户端通信协议与领域契约定义 (SOLID - ISP / DIP)。
 * 涵盖全生命周期动作（叫分、定主、扣底、出牌）。
 */
import { Card, cardId } from '../../cards';
import { BiddingObservation, TrumpObservation, BuryObservation, sanitizeDecisionObservation, sanitizePlayerObservation } from '../decisionObservation';
import { legalObservationCards } from '../optimized/observation';
import { PlayerObservation } from '../optimized/contracts';
import { EngineType, EngineDecision } from './engineTypes';
import type { LlmProtocol, LlmResponseFormat, ReasoningEffort } from './llm/llmClient';

import { AiAction } from '../types';

export type DecisionPhase = 'bidding' | 'trump' | 'bury' | 'playing';

interface DecisionRequestBase {
  seat: number;
  /** SSE progress events followed by a validated result. */
  stream?: boolean;
  phase: DecisionPhase;
  engineType: EngineType;
  // 引擎通用参数与选项
  options?: {
    model?: string;
    timeoutMs?: number;
    reasoningEffort?: ReasoningEffort;
    protocol?: LlmProtocol;
    responseFormat?: LlmResponseFormat;
  };
  fallbackEngine?: EngineType;
}

export type DecisionRequest = DecisionRequestBase & (
  | { phase: 'playing'; observation: PlayerObservation; candidates: Card[] }
  | { phase: 'bidding'; observation: BiddingObservation }
  | { phase: 'trump'; observation: TrumpObservation }
  | { phase: 'bury'; observation: BuryObservation }
);

/** 客户端序列化与服务端调度共用；不再接受旧的全量快照协议。 */
export function sanitizeDecisionRequest(request: DecisionRequest): DecisionRequest {
  if (!request || 'gameStateSnapshot' in request) throw new Error('决策接口不接受完整牌局快照，请使用阶段观察对象');
  if (!Number.isInteger(request.seat) || request.seat < 0 || request.seat > 3
    || !['bridge', 'algorithm', 'laya', 'llm'].includes(request.engineType)) throw new Error('非法决策请求');
  const options = request.options;
  const base: DecisionRequestBase = { seat: request.seat, phase: request.phase, engineType: request.engineType,
    ...(request.stream === true ? { stream: true } : {}),
    ...(request.fallbackEngine ? { fallbackEngine: request.fallbackEngine } : {}),
    ...(options ? { options: { model: options.model, timeoutMs: options.timeoutMs, protocol: options.protocol,
      reasoningEffort: options.reasoningEffort, responseFormat: options.responseFormat } } : {}) };
  if (!request.observation || request.observation.seat !== request.seat) throw new Error('决策座位与观察不一致');
  if (request.phase === 'playing') {
    const observation = sanitizePlayerObservation(request.observation);
    if (!Array.isArray(request.candidates) || request.candidates.length === 0) throw new Error('候选牌集不能为空');
    const legal = legalObservationCards(observation);
    const candidates = request.candidates.map(card => {
      const found = legal.find(candidate => card && cardId(candidate) === cardId(card));
      if (!found) throw new Error('候选牌不属于当前合法手牌');
      return { suit: found.suit, rank: found.rank };
    });
    if (new Set(candidates.map(cardId)).size !== candidates.length) throw new Error('候选牌重复');
    return { ...base, phase: 'playing', observation, candidates };
  }
  const observation = sanitizeDecisionObservation(request.observation);
  if (observation.phase !== request.phase) throw new Error('决策阶段与观察不一致');
  switch (observation.phase) {
    case 'bidding': return { ...base, phase: 'bidding', observation };
    case 'trump': return { ...base, phase: 'trump', observation };
    case 'bury': return { ...base, phase: 'bury', observation };
    default: throw new Error('不支持的决策阶段');
  }
}

export interface DecisionResponse {
  success: boolean;
  action: AiAction;
  decision?: EngineDecision;
  thinking?: string;
  conclusion?: string;
  latencyMs: number;
  engineType: EngineType;
  fallbackReason?: string;
  modelName?: string;
  confidence?: number;
  rawOutput?: string;
  requestPayload?: unknown;
  errorDetails?: string;
  error?: string;
  executionEnvironment: 'server';
}

export type DecisionStreamEvent =
  | { type: 'progress'; progress: import('./engineTypes').ThinkingProgress }
  | { type: 'result'; response: DecisionResponse }
  | { type: 'error'; error: string };
