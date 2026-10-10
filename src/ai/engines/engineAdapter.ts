/**
 * 引擎玩家适配器（DIP 原则：将 DecisionEngine 适配为 PlayerAgent / AsyncPlayerAgent）。
 * 统一执行战术精简、唯一候选快速返回、模型异常优雅回退与全链路日志记录。
 */
import { currentSeat, GameState, legalMoves } from '../../engine';
import { smartAgent } from '../smart';
import { AiAction, AsyncPlayerAgent, PlayerAgent } from '../types';
import { observePlayer } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { DecisionEngine, EngineDecision } from './engineTypes';
import { AlgorithmEngine } from './algorithmEngine';
import { decisionLogger, DecisionLogger } from './decisionLogger';

export interface EnginePlayerAgentOptions {
  engine?: DecisionEngine;
  fallbackEngine?: DecisionEngine;
  nonPlayingAgent?: PlayerAgent;
  logger?: DecisionLogger;
}

export class EnginePlayerAgent implements AsyncPlayerAgent {
  private activeEngine: DecisionEngine;
  private readonly fallbackEngine: DecisionEngine;
  private readonly nonPlayingAgent: PlayerAgent;
  private readonly logger: DecisionLogger;

  constructor(options: EnginePlayerAgentOptions = {}) {
    this.fallbackEngine = options.fallbackEngine ?? new AlgorithmEngine();
    this.activeEngine = options.engine ?? this.fallbackEngine;
    this.nonPlayingAgent = options.nonPlayingAgent ?? smartAgent;
    this.logger = options.logger ?? decisionLogger;
  }

  setEngine(engine: DecisionEngine): void {
    this.activeEngine = engine;
  }

  getEngine(): DecisionEngine {
    return this.activeEngine;
  }

  nextAction(state: GameState): AiAction | null {
    if (state.phase !== 'playing') return this.nonPlayingAgent.nextAction(state);
    const seat = currentSeat(state);
    if (seat < 0) return null;
    const observation = observePlayer(state, seat);
    const legal = legalMoves(state, seat);
    const candidates = pruneCandidates(observation, legal);
    if (candidates.length === 1) {
      return { kind: 'play', seat, card: candidates[0] };
    }
    // 同步调用使用保牌基线 / 算法快速决策
    const chosen = candidates[0];
    return { kind: 'play', seat, card: chosen };
  }

  async nextActionAsync(state: GameState, signal?: AbortSignal): Promise<AiAction | null> {
    if (signal?.aborted) throw new DOMException('已取消决策', 'AbortError');
    if (state.phase !== 'playing') return this.nonPlayingAgent.nextAction(state);

    const seat = currentSeat(state);
    if (seat < 0) return null;

    const observation = observePlayer(state, seat);
    const legal = legalMoves(state, seat);
    const candidates = pruneCandidates(observation, legal);

    // 唯一候选直接出牌（无需发起模型网络请求或耗费搜索）
    if (candidates.length === 1) {
      const singleCard = candidates[0];
      this.logger.record({
        seat,
        engineType: this.activeEngine.type,
        roundNumber: state.trickNumber,
        trickNumber: state.trickNumber,
        ownHand: [...state.hands[seat]],
        currentRound: state.trick.map((t) => ({ seat: t.seat, card: t.card })),
        candidates: [...candidates],
        chosenCard: singleCard,
        latencyMs: 0,
        diagnostic: '唯一候选直接出牌',
      });
      return { kind: 'play', seat, card: singleCard };
    }

    let decision: EngineDecision;
    let fallbackReason: string | undefined;

    try {
      decision = await this.activeEngine.chooseCard(observation, candidates, signal);
    } catch (error: any) {
      if (signal?.aborted) throw error;
      fallbackReason = error instanceof Error ? error.message : String(error);
      // 模型超时、错误或非法回答回退到算法
      decision = await this.fallbackEngine.chooseCard(observation, candidates, signal);
      decision = {
        ...decision,
        fallbackReason: `从 ${this.activeEngine.type} 回退: ${fallbackReason}`,
      };
    }

    this.logger.record({
      seat,
      engineType: decision.engineType,
      requestedEngine: this.activeEngine.type,
      roundNumber: state.trickNumber,
      trickNumber: state.trickNumber,
      ownHand: [...state.hands[seat]],
      currentRound: state.trick.map((t) => ({ seat: t.seat, card: t.card })),
      candidates: [...candidates],
      chosenCard: decision.card,
      latencyMs: decision.latencyMs,
      searchWinRate: decision.searchWinRate,
      probabilities: decision.probabilities,
      confidence: decision.confidence,
      fallbackReason: decision.fallbackReason,
      diagnostic: decision.diagnostic,
    });

    return { kind: 'play', seat, card: decision.card };
  }
}
