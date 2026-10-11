/**
 * 保山幺子分 服务端与客户端通信协议与领域契约定义 (SOLID - ISP / DIP)。
 * 涵盖全生命周期动作（叫分、定主、扣底、出牌）。
 */
import { Card, Suit } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { EngineType, EngineDecision } from './engineTypes';
import type { LlmProtocol, LlmResponseFormat, ReasoningEffort } from './llm/llmClient';

import { AiAction } from '../types';

export type DecisionPhase = 'bidding' | 'declaring' | 'trump' | 'bury' | 'playing';

export interface DecisionRequest {
  seat: number;
  /** SSE progress events followed by a validated result. */
  stream?: boolean;
  phase: DecisionPhase;
  engineType: EngineType;
  // 出牌阶段 (playing) 字段
  observation?: PlayerObservation;
  candidates?: Card[];
  // 叫分阶段 (bidding) 字段
  hand?: Card[];
  legalBids?: number[];
  highestBid?: number | null;
  // 定主阶段 (declaring / trump) 字段
  trump?: Suit;
  kittySize?: number;
  // 局势快照
  gameStateSnapshot?: any;
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
