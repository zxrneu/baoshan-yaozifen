/**
 * 决策引擎领域模型与统一异步接口（ISP / DIP 原则）。
 * 搜索胜率与模型概率分别记录，不混用。
 */
import { Card } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';

export type EngineType = 'bridge' | 'algorithm' | 'llm' | 'laya';

export interface EngineDecision {
  card: Card;
  engineType: EngineType;
  latencyMs: number;
  diagnostic?: string;
  /** 搜索估计的赢副率（传统算法），不与模型概率混用 */
  searchWinRate?: number;
  /** 模型候选选项概率（LLM / Laya） */
  probabilities?: Record<string, number>;
  /** 模型置信度 */
  confidence?: number;
  /** 发生回退时的原因说明 */
  fallbackReason?: string;
}

export interface DecisionEngine {
  readonly type: EngineType;
  chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision>;
}

export interface DecisionRecord {
  id: string;
  timestamp: number;
  seat: number;
  engineType: EngineType;
  requestedEngine?: EngineType;
  roundNumber: number;
  trickNumber: number;
  ownHand: Card[];
  currentRound: { seat: number; card: Card }[];
  candidates: Card[];
  chosenCard: Card;
  latencyMs: number;
  searchWinRate?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  fallbackReason?: string;
  diagnostic?: string;
}
