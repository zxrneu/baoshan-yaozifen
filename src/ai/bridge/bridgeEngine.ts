/**
 * 桥牌深度思考算法决策引擎 (Bridge Decision Engine)。
 * 实现统一异步契约 DecisionEngine，遵循 SOLID 设计原则。
 */
import { Card, cardId, cardLabel } from '../../cards';
import { PlayerObservation } from '../optimized/contracts';
import { DecisionEngine, EngineDecision, ActionDecision } from '../engines/engineTypes';
import { evaluateBridgeTactics } from './heuristics';
import type { BridgePimcEvaluator } from './pimc';
import { legalObservationCards } from '../optimized/observation';
import { pruneCandidates } from '../tactics';
import { bidFromObservation, trumpFromObservation, buryFromObservation } from '../smart';
import { DecisionObservation, BiddingObservation, TrumpObservation, BuryObservation, sanitizeDecisionObservation, sanitizePlayerObservation } from '../decisionObservation';
import {
  BridgeThinkingConfig,
  DEFAULT_DEEP_THINKING_CONFIG,
} from './types';

export interface BridgeEngineOptions {
  config?: BridgeThinkingConfig;
  pimcEvaluator?: BridgePimcEvaluator;
}

export class BridgeEngine implements DecisionEngine {
  readonly type = 'bridge' as const;
  private readonly config: BridgeThinkingConfig;
  private pimcEvaluator?: BridgePimcEvaluator;

  constructor(options: BridgeEngineOptions = {}) {
    this.config = options.config ?? DEFAULT_DEEP_THINKING_CONFIG;
    this.pimcEvaluator = options.pimcEvaluator;
  }

  async chooseCard(
    observation: PlayerObservation,
    candidates: readonly Card[],
    signal?: AbortSignal,
  ): Promise<EngineDecision> {
    observation = sanitizePlayerObservation(observation);
    const started = performance.now();
    if (candidates.length === 0) throw new Error('候选牌集不能为空');

    // 1. 唯一候选直接出牌 (0ms)
    if (candidates.length === 1) {
      return {
        card: candidates[0],
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        diagnostic: '唯一候选直接出牌',
      };
    }

    // 2. 已取消：取消是控制流信号，必须上抛而不是「改用专家规则」返回一张牌。
    //    若在此静默返回，调用方会以为 AI 正常算完并落了子，取消语义被彻底架空。
    if (signal?.aborted) {
      throw signal.reason ?? new Error('已取消');
    }

    // 3. 若模式为 fast，使用纯桥牌专家启发式规则 (< 1ms)
    if (this.config.mode === 'fast') {
      const advice = evaluateBridgeTactics(observation, candidates);
      return {
        card: advice.card,
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: `桥牌专家战术规则系统研判：${advice.reason}。意图类型：${advice.intent}。`,
        conclusion: `遵循战术【${advice.intent}】，决定出 ${advice.card.rank}${advice.card.suit}。`,
        searchWinRate: advice.score / 100,
        confidence: 0.85,
        diagnostic: `桥牌专家战术[极速]: ${advice.reason} (${advice.intent})`,
      };
    }

    // 4. 深度思考模式：调用 DDS-PIMC 完美信息蒙特卡洛引擎
    try {
      this.pimcEvaluator ??= new (await import('./pimc')).BridgePimcEvaluator({ config: this.config });
      const pimcDecision = await this.pimcEvaluator.evaluate(
        observation,
        candidates,
        signal,
      );

      const chosenCard =
        candidates.find((c) => cardId(c) === cardId(pimcDecision.card)) ??
        candidates[0];

      const movesDesc = pimcDecision.moves
        .map(
          (m) =>
            m.samples > 0
              ? `${m.card.rank}${m.card.suit}: 胜率 ${(m.winRate * 100).toFixed(0)}%, 期望分 ${m.expectedPoints.toFixed(1)} (样本 ${m.samples}w)`
              : `${m.card.rank}${m.card.suit}: 无搜索样本`,
        )
        .join(' | ');

      const candidateEvaluations = candidates.map((c) => {
        const found = pimcDecision.moves.find((m) => cardId(m.card) === cardId(c));
        const evaluated = found !== undefined && found.samples > 0;
        return {
          card: c,
          winRate: evaluated ? found.winRate : undefined,
          expectedPoints: evaluated ? found.expectedPoints : undefined,
          samples: found?.samples,
          exactSamples: found?.exactSamples,
          rolloutSamples: found?.rolloutSamples,
          forced: found?.forced,
          isChosen: cardId(c) === cardId(chosenCard),
        };
      });

      if (pimcDecision.unevaluated || pimcDecision.worldsEvaluated === 0) {
        // 零样本的中性基线不能进入 UI 或日志。预算耗尽属于正常降级，
        // 世界构造/采样异常仍明确标为未评估；已有样本则继续使用真实估值。
        const reason = pimcDecision.unevaluated
          ? '未评估'
          : pimcDecision.budgetExhausted ? '搜索预算不足' : '无有效搜索样本';
        return {
          card: chosenCard,
          engineType: 'bridge',
          latencyMs: performance.now() - started,
          thinking: `${reason}，未完成任何世界评估，改用专家规则建议。\n${pimcDecision.diagnostic}`,
          conclusion: `${reason}，专家规则建议 ${chosenCard.rank}${chosenCard.suit}。`,
          fallbackReason: pimcDecision.diagnostic,
          diagnostic: pimcDecision.diagnostic,
          candidateEvaluations,
          worldsEvaluated: pimcDecision.worldsEvaluated,
          searchStatusCounts: pimcDecision.searchStatusCounts,
        };
      }

      return {
        card: chosenCard,
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: `位棋盘 DDS 求解器完成 ${pimcDecision.worldsEvaluated} 个样本世界评估。\n各候选牌博弈树估值：${movesDesc}`,
        conclusion: `DDS 搜索选出最优期望牌 ${chosenCard.rank}${chosenCard.suit} (胜率 ${(pimcDecision.winRate * 100).toFixed(1)}%)。`,
        searchWinRate: pimcDecision.winRate,
        confidence: pimcDecision.winRate,
        diagnostic: pimcDecision.diagnostic,
        candidateEvaluations,
        worldsEvaluated: pimcDecision.worldsEvaluated,
        searchStatusCounts: pimcDecision.searchStatusCounts,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      // 异常情况下平滑回退到桥牌专家战术
      const fallbackAdvice = evaluateBridgeTactics(observation, candidates);
      return {
        card: fallbackAdvice.card,
        engineType: 'bridge',
        latencyMs: performance.now() - started,
        thinking: `DDS 搜索异常 (${error instanceof Error ? error.message : String(error)})，回退专家规则：${fallbackAdvice.reason}`,
        conclusion: `专家规则接管，选出 ${fallbackAdvice.card.rank}${fallbackAdvice.card.suit}。`,
        fallbackReason: error instanceof Error ? error.message : String(error),
        diagnostic: `搜索异常回退专家规则: ${fallbackAdvice.reason}`,
      };
    }
  }

  async chooseBid(observation: BiddingObservation, _signal?: AbortSignal): Promise<ActionDecision> {
    const { seat } = observation;
    const started = performance.now();
    const bidVal = bidFromObservation(observation);
    return {
      action: { kind: 'bid', seat, bid: bidVal },
      engineType: 'bridge',
      latencyMs: performance.now() - started,
      thinking: '桥牌牌力与赢墩估算：基于控制力(A/K)、长套分布与主牌潜质评估吃分期望。',
      conclusion: bidVal === null ? '不叫' : `叫 ${bidVal} 分`,
      confidence: 0.9,
    };
  }

  async chooseTrump(observation: TrumpObservation, _signal?: AbortSignal): Promise<ActionDecision> {
    const { seat } = observation;
    const started = performance.now();
    const trumpVal = trumpFromObservation(observation);
    return {
      action: { kind: 'trump', seat, trump: trumpVal },
      engineType: 'bridge',
      latencyMs: performance.now() - started,
      thinking: '桥牌选主评估：综合长套长度、A/K/Q 大牌控制力与分牌集中度。',
      conclusion: `定主: ${trumpVal}`,
      confidence: 0.95,
    };
  }

  async chooseBury(observation: BuryObservation, _signal?: AbortSignal): Promise<ActionDecision> {
    const { seat } = observation;
    const started = performance.now();
    const cards = buryFromObservation(observation);
    return {
      action: { kind: 'bury', seat, cards },
      engineType: 'bridge',
      latencyMs: performance.now() - started,
      thinking: '桥牌扣底策略：短门造绝门以备将牌纵杀，同时保护长套高牌赢张。',
      conclusion: `扣底 ${cards.map((c) => cardLabel(c)).join(' ')}。`,
      confidence: 0.95,
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
        engineType: 'bridge',
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
