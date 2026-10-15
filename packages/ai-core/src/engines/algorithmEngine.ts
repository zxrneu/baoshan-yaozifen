/**
 * 传统算法决策引擎（SRP：执行配对胜率搜索与信息集残局求解）。
 * 默认在 Worker 中运行，预算 250ms；将 ISMCTS 作为后续对照方案。
 * 支持全生命周期（叫分、定主、扣底、出牌）决策。
 */
import { Card, cardId, cardLabel } from '@yaozifen/game-core/cards';
import { AsyncCardSelector, PlayerObservation } from '../optimized/contracts';
import { WorkerCardSelector } from '../optimized/workerClient';
import { DecisionEngine, EngineDecision, ActionDecision } from './engineTypes';
import { legalObservationCards } from '@yaozifen/game-view/observation';
import { pruneCandidates } from '../tactics';
import { bidFromObservation, trumpFromObservation, buryFromObservation } from '../smart';
import { DecisionObservation, BiddingObservation, TrumpObservation, BuryObservation, sanitizeDecisionObservation, sanitizePlayerObservation } from '@yaozifen/game-view/decisionObservation';

export class AlgorithmEngine implements DecisionEngine {
  readonly type = 'algorithm' as const;
  private readonly selector: AsyncCardSelector;

  constructor(selector?: AsyncCardSelector) {
    this.selector = selector ?? new WorkerCardSelector();
  }

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision> {
    observation = sanitizePlayerObservation(observation);
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'algorithm',
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
      };
    }

    const decision = await this.selector.choose(observation, signal);
    const chosen =
      candidates.find((c) => cardId(c) === cardId(decision.card)) ?? candidates[0];
    const moveEst = decision.moves.find((m) => cardId(m.card) === cardId(chosen));

    const winRatePct = moveEst?.winRate !== undefined ? `${(moveEst.winRate * 100).toFixed(1)}%` : '未评估';
    const movesDesc = decision.moves
      .map((m) => `${m.card.rank}${m.card.suit}: ${(m.winRate * 100).toFixed(0)}%`)
      .join(' | ');

    const candidateEvaluations = candidates.map((c) => {
      const found = decision.moves.find((m) => cardId(m.card) === cardId(c));
      return {
        card: c,
        winRate: found?.winRate,
        isChosen: cardId(c) === cardId(chosen),
      };
    });

    return {
      card: chosen,
      engineType: 'algorithm',
      latencyMs: performance.now() - started,
      searchWinRate: moveEst?.winRate,
      confidence: moveEst?.winRate,
      thinking: `Worker 约束蒙特卡洛采样完成 ${decision.worlds} 个样本世界评估。\n评估状态: ${decision.status}。\n候选牌估计胜率: ${movesDesc || winRatePct}`,
      conclusion: `算法引擎选出评估胜率最高手牌 ${chosen.rank}${chosen.suit} (预估胜率 ${winRatePct})。`,
      diagnostic:
        decision.diagnostic ?? `状态: ${decision.status}, 世界样本: ${decision.worlds}`,
      candidateEvaluations,
      worldsEvaluated: decision.worlds,
    };
  }

  async chooseBid(observation: BiddingObservation, _signal?: AbortSignal): Promise<ActionDecision> {
    const { seat } = observation;
    const started = performance.now();
    const bidVal = bidFromObservation(observation);
    return {
      action: { kind: 'bid', seat, bid: bidVal },
      engineType: 'algorithm',
      latencyMs: performance.now() - started,
      thinking: '传统启发式牌力折价与大牌控制力评估。',
      conclusion: bidVal === null ? '不叫' : `叫 ${bidVal} 分`,
      confidence: 0.85,
    };
  }

  async chooseTrump(observation: TrumpObservation, _signal?: AbortSignal): Promise<ActionDecision> {
    const { seat } = observation;
    const started = performance.now();
    const trumpVal = trumpFromObservation(observation);
    return {
      action: { kind: 'trump', seat, trump: trumpVal },
      engineType: 'algorithm',
      latencyMs: performance.now() - started,
      thinking: '传统算法定主：长套长度与大牌集中度加权。',
      conclusion: `定主: ${trumpVal}`,
      confidence: 0.9,
    };
  }

  async chooseBury(observation: BuryObservation, _signal?: AbortSignal): Promise<ActionDecision> {
    const { seat } = observation;
    const started = performance.now();
    const cards = buryFromObservation(observation);
    return {
      action: { kind: 'bury', seat, cards },
      engineType: 'algorithm',
      latencyMs: performance.now() - started,
      thinking: '传统算法扣底：短门制造、严禁扣分牌与保留大牌。',
      conclusion: `扣底 ${cards.map((c) => cardLabel(c)).join(' ')}。`,
      confidence: 0.9,
    };
  }

  async chooseAction(observation: DecisionObservation, signal?: AbortSignal): Promise<ActionDecision> {
    observation = sanitizeDecisionObservation(observation);
    const { seat } = observation;
    if (observation.phase === 'bidding') {
      return this.chooseBid(observation, signal);
    }
    if (observation.phase === 'trump') {
      return this.chooseTrump(observation, signal);
    }
    if (observation.phase === 'bury') {
      return this.chooseBury(observation, signal);
    }
    if (observation.phase === 'playing') {
      const legal = legalObservationCards(observation);
      const candidates = pruneCandidates(observation, legal);
      const decision = await this.chooseCard(observation, candidates, signal);
      return {
        action: { kind: 'play', seat, card: decision.card },
        decision,
        engineType: 'algorithm',
        latencyMs: decision.latencyMs,
        thinking: decision.thinking,
        conclusion: decision.conclusion,
        confidence: decision.confidence,
        modelName: decision.modelName,
        probabilities: decision.probabilities,
        fallbackReason: decision.fallbackReason,
        errorDetails: decision.errorDetails,
      };
    }
    throw new Error('不支持的决策阶段');
  }
}
